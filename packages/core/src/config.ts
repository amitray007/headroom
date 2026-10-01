import { z } from "zod";

import { type Provider, providerSchema } from "./enums.ts";

/**
 * Runtime configuration from the environment. Defaults suit local development only;
 * a deployment sets every path explicitly. See docs/architecture/deployment.md.
 */

const originSchema = z.url().transform((value, ctx) => {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) {
    ctx.addIssue({ code: "custom", message: "must be an origin without path, query or fragment" });
    return z.NEVER;
  }
  return url.origin;
});

export const configSchema = z.object({
  /** Directory for headroom.db and attempt scratch directories. Backed up as a unit. */
  dataDir: z.string().min(1).default(".data"),
  /** 32-byte hex key file kept outside the data directory. Losing it loses every connection. */
  masterKeyFile: z.string().min(1).default(".state/headroom.key"),
  /** Session signing secret file, created on first run. Rotating it signs everyone out. */
  authSecretFile: z.string().min(1).default(".state/headroom.auth-secret"),
  port: z.coerce.number().int().min(1).max(65535).default(8080),
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
  /** Connectors the owner has turned on, comma separated. Private-interface connectors stay off unless listed. */
  enabledProviders: z
    .string()
    .default("codex")
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .pipe(z.array(providerSchema)),
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
  publicUrl: "HEADROOM_PUBLIC_URL",
  trustedOrigins: "HEADROOM_TRUSTED_ORIGINS",
  logLevel: "HEADROOM_LOG_LEVEL",
  enabledProviders: "HEADROOM_ENABLED_PROVIDERS",
  refreshIntervalSeconds: "HEADROOM_REFRESH_INTERVAL_SECONDS",
  staleAfterSeconds: "HEADROOM_STALE_AFTER_SECONDS",
} as const satisfies Record<keyof Config, string>;

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const raw: Record<string, string | undefined> = {};
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
