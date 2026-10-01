import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  type Auth,
  baseUrl,
  type Config,
  createAuth,
  CredentialStore,
  crypto,
  type Db,
  LeaseStore,
  openDatabase,
} from "@headroom/core";

/** Everything the routes need, built once at start or once per test. */
export interface AppContext {
  readonly config: Config;
  readonly db: Db;
  /** Raw handle for pragmas and migration inspection. Routes use `db`. */
  readonly sqlite: Database;
  readonly keyring: crypto.Keyring;
  readonly auth: Auth;
  readonly credentials: CredentialStore;
  readonly leases: LeaseStore;
  /** Origins allowed for CORS, Better Auth and frame-ancestors. Always includes the base URL. */
  readonly trustedOrigins: readonly string[];
  readonly log: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

export interface BootstrapOptions {
  readonly config: Config;
  /** Override the database path; tests pass ":memory:". */
  readonly databasePath?: string;
  /** Override the keyring; tests pass a generated one so no key file is touched. */
  readonly keyring?: crypto.Keyring;
  /** Override the auth secret; tests pass one so no secret file is touched. */
  readonly authSecret?: string;
  /** Tests disable Better Auth rate limiting; production never passes this. */
  readonly rateLimit?: boolean;
  readonly log?: AppContext["log"];
}

/**
 * Load or create the master key and auth secret, open the database, and build the stores.
 * Secret files are created with mode 0600 on first run and never regenerated after that.
 */
export function bootstrap(options: BootstrapOptions): AppContext {
  const { config } = options;
  const log = options.log ?? (() => undefined);
  const keyring =
    options.keyring ??
    crypto.createKeyring({
      1: crypto.parseKeyHex(
        loadOrCreateSecretFile(config.masterKeyFile, crypto.generateKeyHex, log, "master key"),
      ),
    });
  const authSecret =
    options.authSecret ??
    loadOrCreateSecretFile(config.authSecretFile, crypto.generateKeyHex, log, "auth secret");
  const databasePath = options.databasePath ?? join(config.dataDir, "headroom.db");
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const { db, sqlite } = openDatabase({ path: databasePath });
  const origin = baseUrl(config);
  const trustedOrigins = [...new Set([origin, ...config.trustedOrigins])];
  return {
    config,
    db,
    sqlite,
    keyring,
    auth: createAuth({
      db,
      secret: authSecret,
      baseUrl: origin,
      trustedOrigins,
      log,
      ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
    }),
    credentials: new CredentialStore(db, keyring),
    leases: new LeaseStore(db),
    trustedOrigins,
    log,
  };
}

/** Read a one-line secret file, or create it with mode 0600 and a warning to back it up. */
export function loadOrCreateSecretFile(
  path: string,
  generate: () => string,
  log: AppContext["log"],
  label: string,
): string {
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const value = generate();
  writeFileSync(path, `${value}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  log("warn", `created a new ${label} at ${path}; back it up, losing it loses every connection`);
  return value;
}
