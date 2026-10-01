import { z } from "zod";

/**
 * Runtime configuration from the environment. Defaults suit local development only;
 * a deployment sets every path explicitly. See docs/architecture/deployment.md.
 */
export const configSchema = z.object({
  /** Directory for headroom.db and attempt scratch directories. Backed up as a unit. */
  dataDir: z.string().min(1).default(".data"),
  /** 32-byte hex key file kept outside the data directory. Losing it loses every connection. */
  masterKeyFile: z.string().min(1).default(".state/headroom.key"),
  port: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Public origin, e.g. https://headroom.example.com. Enables Secure cookies and origin checks. */
  publicUrl: z.url().optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof configSchema>;

const envKeys = {
  dataDir: "HEADROOM_DATA_DIR",
  masterKeyFile: "HEADROOM_MASTER_KEY_FILE",
  port: "HEADROOM_PORT",
  publicUrl: "HEADROOM_PUBLIC_URL",
  logLevel: "HEADROOM_LOG_LEVEL",
} as const satisfies Record<keyof Config, string>;

export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const raw: Record<string, string | undefined> = {};
  for (const [field, key] of Object.entries(envKeys)) {
    const value = env[key];
    if (value !== undefined && value !== "") raw[field] = value;
  }
  return configSchema.parse(raw);
}
