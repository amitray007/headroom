import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  type Config,
  CredentialStore,
  crypto,
  type Db,
  LeaseStore,
  OwnerStore,
  openDatabase,
} from "@headroom/core";

/** Everything the routes need, built once at start or once per test. */
export interface AppContext {
  readonly config: Config;
  readonly db: Db;
  /** Raw handle for pragmas and migration inspection. Routes use `db`. */
  readonly sqlite: Database;
  readonly keyring: crypto.Keyring;
  readonly owner: OwnerStore;
  readonly credentials: CredentialStore;
  readonly leases: LeaseStore;
  readonly log: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

export interface BootstrapOptions {
  readonly config: Config;
  /** Override the database path; tests pass ":memory:". */
  readonly databasePath?: string;
  /** Override the keyring; tests pass a generated one so no key file is touched. */
  readonly keyring?: crypto.Keyring;
  readonly log?: AppContext["log"];
}

/**
 * Load or create the master key, open the database, and build the stores.
 * The key file is created with mode 0600 on first run and never regenerated after that.
 */
export function bootstrap(options: BootstrapOptions): AppContext {
  const { config } = options;
  const log = options.log ?? (() => undefined);
  const keyring = options.keyring ?? loadOrCreateKeyring(config.masterKeyFile, log);
  const databasePath = options.databasePath ?? join(config.dataDir, "headroom.db");
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const { db, sqlite } = openDatabase({ path: databasePath });
  return {
    config,
    db,
    sqlite,
    keyring,
    owner: new OwnerStore(db),
    credentials: new CredentialStore(db, keyring),
    leases: new LeaseStore(db),
    log,
  };
}

export function loadOrCreateKeyring(path: string, log: AppContext["log"]): crypto.Keyring {
  if (existsSync(path)) {
    return crypto.createKeyring({ 1: crypto.parseKeyHex(readFileSync(path, "utf8")) });
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const hex = crypto.generateKeyHex();
  writeFileSync(path, `${hex}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  log("warn", `created a new master key at ${path}; back it up, losing it loses every connection`);
  return crypto.createKeyring({ 1: crypto.parseKeyHex(hex) });
}
