import { homedir } from "node:os";

import { z } from "zod";

import { type Provider, providerSchema } from "./enums.ts";

/**
 * Runtime configuration from the environment. Path defaults are per-user locations for the
 * current platform; development and containers set them explicitly. See docs/architecture/deployment.md.
 */

const originSchema = z.url().transform((value, ctx) => {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) {
    ctx.addIssue({ code: "custom", message: "must be an origin without path, query or fragment" });
    return z.NEVER;
  }
  return url.origin;
});

const allProviders = providerSchema.options.join(",");

export const configSchema = z.object({
  /** Directory for headroom.db and attempt scratch directories. Backed up as a unit. */
  dataDir: z.string().min(1),
  /** 32-byte hex key file kept outside the data directory. Losing it loses every connection. */
  masterKeyFile: z.string().min(1),
  /** Session signing secret file, created on first run. Rotating it signs everyone out. */
  authSecretFile: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Interface to listen on. Loopback unless the owner opens it up; containers set 0.0.0.0. */
  host: z.string().min(1).default("127.0.0.1"),
  /** Public origin, e.g. https://headroom.example.com. Enables Secure cookies, passkeys and origin checks. */
  publicUrl: originSchema.optional(),
  /** Extra origins allowed to call the API and embed the UI, comma separated. The public URL is always allowed. */
  trustedOrigins: z
    .string()
    .default("")
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .pipe(z.array(originSchema)),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Trust X-Forwarded-For from the reverse proxy for the client address. Off unless Headroom sits behind one. */
  trustProxy: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Directory with the built web UI (index.html and assets). Empty disables static serving. */
  webDir: z.string().default("apps/web/dist"),
  /** Connectors the owner has turned on, comma separated. Private-interface connectors stay off unless listed. */
  enabledProviders: z
    .string()
    .default(allProviders)
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .pipe(z.array(providerSchema)),
  /** Absolute path of the codex, claude and grok sign-in CLIs. Unset resolves them on PATH. */
  codexBin: z.string().min(1).optional(),
  claudeBin: z.string().min(1).optional(),
  grokBin: z.string().min(1).optional(),
  /** Seconds between scheduled collections per connection. */
  refreshIntervalSeconds: z.coerce.number().int().min(60).default(900),
  /** Seconds after the last success before the card shows a stale notice. */
  staleAfterSeconds: z.coerce
    .number()
    .int()
    .min(60)
    .default(12 * 60 * 60),
});

export type Config = z.infer<typeof configSchema>;

const envKeys = {
  dataDir: "HEADROOM_DATA_DIR",
  masterKeyFile: "HEADROOM_MASTER_KEY_FILE",
  authSecretFile: "HEADROOM_AUTH_SECRET_FILE",
  port: "HEADROOM_PORT",
  host: "HEADROOM_HOST",
  publicUrl: "HEADROOM_PUBLIC_URL",
  trustedOrigins: "HEADROOM_TRUSTED_ORIGINS",
  logLevel: "HEADROOM_LOG_LEVEL",
  trustProxy: "HEADROOM_TRUST_PROXY",
  webDir: "HEADROOM_WEB_DIR",
  enabledProviders: "HEADROOM_ENABLED_PROVIDERS",
  codexBin: "HEADROOM_CODEX_BIN",
  claudeBin: "HEADROOM_CLAUDE_BIN",
  grokBin: "HEADROOM_GROK_BIN",
  refreshIntervalSeconds: "HEADROOM_REFRESH_INTERVAL_SECONDS",
  staleAfterSeconds: "HEADROOM_STALE_AFTER_SECONDS",
} as const satisfies Record<keyof Config, string>;

/** Where the OS keeps per-user state. Injected so tests can pick a platform and home. */
export interface PlatformInfo {
  readonly platform: string;
  readonly home: string;
}

export interface PathDefaults {
  readonly dataDir: string;
  readonly masterKeyFile: string;
  readonly authSecretFile: string;
}

function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/{2,}/g, "/");
}

/**
 * Per-user default locations. macOS keeps everything under Application Support; elsewhere the data
 * follows XDG_DATA_HOME and the secrets follow XDG_CONFIG_HOME, so the key never sits in the data folder.
 */
export function defaultPaths(
  env: Readonly<Record<string, string | undefined>>,
  info: PlatformInfo,
): PathDefaults {
  if (info.platform === "darwin") {
    const root = joinPath(info.home, "Library/Application Support/Headroom");
    return {
      dataDir: joinPath(root, "data"),
      masterKeyFile: joinPath(root, "headroom.key"),
      authSecretFile: joinPath(root, "headroom.auth-secret"),
    };
  }
  const dataHome = env["XDG_DATA_HOME"] || joinPath(info.home, ".local/share");
  const configHome = env["XDG_CONFIG_HOME"] || joinPath(info.home, ".config");
  return {
    dataDir: joinPath(dataHome, "headroom/data"),
    masterKeyFile: joinPath(configHome, "headroom/headroom.key"),
    authSecretFile: joinPath(configHome, "headroom/headroom.auth-secret"),
  };
}

export function loadConfig(
  env: Readonly<Record<string, string | undefined>>,
  info: PlatformInfo = { platform: process.platform, home: env["HOME"] || homedir() },
): Config {
  const raw: Record<string, string | undefined> = { ...defaultPaths(env, info) };
  for (const [field, key] of Object.entries(envKeys)) {
    const value = env[key];
    if (value !== undefined && value !== "") raw[field] = value;
  }
  return configSchema.parse(raw);
}

/** The origin Headroom believes it is served from: the public URL, else localhost on the port. */
export function baseUrl(config: Config): string {
  return config.publicUrl ?? `http://localhost:${config.port}`;
}

export function isProviderEnabled(config: Config, provider: Provider): boolean {
  return config.enabledProviders.includes(provider);
}
