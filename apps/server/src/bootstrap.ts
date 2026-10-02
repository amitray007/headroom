import type { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  ActionService,
  ActionStore,
  AttemptStore,
  CliLoginRunner,
  type Auth,
  baseUrl,
  CollectionService,
  type Config,
  ConnectionStore,
  type Connector,
  type ConnectorRegistry,
  ConnectService,
  createAuth,
  CredentialStore,
  crypto,
  type Db,
  LeaseStore,
  openDatabase,
  SettingsStore,
  SnapshotStore,
} from "@headroom/core";

import { createRegistry } from "./registry.ts";

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
  readonly attempts: AttemptStore;
  readonly connections: ConnectionStore;
  readonly snapshots: SnapshotStore;
  readonly settings: SettingsStore;
  readonly registry: ConnectorRegistry;
  readonly runner: CliLoginRunner;
  readonly connect: ConnectService;
  readonly collection: CollectionService;
  readonly actions: ActionService;
  /** Origins allowed for CORS, Better Auth and frame-ancestors. Always includes the base URL. */
  readonly trustedOrigins: readonly string[];
  readonly now: () => Date;
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
  /** Every connector the build knows about; the config decides which are enabled. Receives the runner. */
  readonly connectors?: readonly Connector[] | ((runner: CliLoginRunner) => readonly Connector[]);
  readonly now?: () => Date;
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
  const now = options.now ?? (() => new Date());
  const credentials = new CredentialStore(db, keyring);
  const leases = new LeaseStore(db, now);
  const attempts = new AttemptStore(db, keyring, now);
  const connections = new ConnectionStore(db, now);
  const snapshots = new SnapshotStore(db, now);
  const settings = new SettingsStore(db, config.refreshIntervalSeconds, now);
  const runner = new CliLoginRunner({ attemptsDir: join(config.dataDir, "attempts") });
  if (databasePath !== ":memory:") runner.sweep();
  const available =
    typeof options.connectors === "function"
      ? options.connectors(runner)
      : (options.connectors ?? []);
  const registry = createRegistry(available, config.enabledProviders);
  const collection = new CollectionService({
    registry,
    connections,
    credentials,
    snapshots,
    leases,
    now,
  });
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
    credentials,
    leases,
    attempts,
    connections,
    snapshots,
    settings,
    registry,
    runner,
    connect: new ConnectService({ registry, attempts, connections, credentials, snapshots, now }),
    collection,
    actions: new ActionService({
      // The owner's setting is the only gate; it is read at call time.
      enabled: () => settings.get().accountActions,
      registry,
      connections,
      credentials,
      snapshots,
      actions: new ActionStore(db, now),
      leases,
      collection,
    }),
    trustedOrigins,
    now,
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
