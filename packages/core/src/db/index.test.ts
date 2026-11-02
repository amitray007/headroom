import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appliedMigrations, openDatabase, schema } from "./index.ts";

describe("openDatabase", () => {
  test("applies the embedded migrations once and records them", () => {
    const { sqlite } = openDatabase({ path: ":memory:" });
    expect(appliedMigrations(sqlite)).toEqual([
      "0000_init",
      "0001_names_and_settings",
      "0002_display_order",
      "0003_notification_delivery",
      "0004_wallet",
      "0005_single_owner",
      "0006_automations",
      "0007_expiry_reset",
      "0008_api_tokens",
      "0009_notice_reads",
    ]);
    const tables = sqlite
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "user",
        "session",
        "account",
        "verification",
        "passkey",
        "apikey",
        "connections",
        "credentials",
        "auth_attempts",
        "connection_capabilities",
        "sync_runs",
        "snapshots",
        "metrics",
        "reset_credits",
        "account_actions",
        "leases",
        "settings",
        "wallet_costs",
        "wallet_top_ups",
        "notice_reads",
        "headroom_migrations",
      ]),
    );
  });

  test("sets the required pragmas", () => {
    const { sqlite } = openDatabase({ path: ":memory:" });
    const fk = sqlite.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get();
    expect(fk?.foreign_keys).toBe(1);
  });

  test("foreign keys cascade and typed inserts round-trip", () => {
    const { db, sqlite } = openDatabase({ path: ":memory:" });
    db.insert(schema.connections)
      .values({
        id: "c1",
        provider: "codex",
        providerAccountId: "acct",
        scope: "individual",
        label: "Codex",
        authMethod: "cli_login",
        state: "ready",
        interface: "private",
        connectorVersion: "0.0.0",
      })
      .run();
    db.insert(schema.credentials)
      .values({
        connectionId: "c1",
        ciphertext: Buffer.from("x"),
        nonce: Buffer.from("n"),
        keyVersion: 1,
        refreshState: "fresh",
      })
      .run();
    expect(db.select().from(schema.credentials).all()).toHaveLength(1);
    sqlite.run("DELETE FROM connections WHERE id = 'c1'");
    expect(db.select().from(schema.credentials).all()).toHaveLength(0);
  });

  test("rejects a value outside the canonical enumeration at the type level", () => {
    const { db } = openDatabase({ path: ":memory:" });
    // @ts-expect-error "connected" is not a canonical connection state
    const bad = { state: "connected" } satisfies Partial<typeof schema.connections.$inferInsert>;
    expect(bad.state).toBe("connected");
    expect(db).toBeDefined();
  });

  test.skipIf(process.platform === "win32")(
    "creates the directory 0700 and keeps the database and its WAL files 0600",
    () => {
      const root = mkdtempSync(join(tmpdir(), "headroom-db-"));
      try {
        const dir = join(root, "data");
        const path = join(dir, "headroom.db");
        const { sqlite } = openDatabase({ path });
        sqlite.run("CREATE TABLE IF NOT EXISTS probe (x integer)");
        sqlite.run("INSERT INTO probe VALUES (1)");
        expect(statSync(dir).mode & 0o777).toBe(0o700);
        for (const file of [path, `${path}-wal`, `${path}-shm`])
          expect(statSync(file).mode & 0o777).toBe(0o600);
        sqlite.close();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(process.platform === "win32")("tightens an existing 0644 database on open", () => {
    const root = mkdtempSync(join(tmpdir(), "headroom-db-"));
    try {
      const path = join(root, "headroom.db");
      openDatabase({ path }).sqlite.close();
      chmodSync(path, 0o644);
      const { sqlite } = openDatabase({ path });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      sqlite.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("0007 gives an existing auto-reset rule use-before-expiry, on at 2 minutes", () => {
    const root = mkdtempSync(join(tmpdir(), "headroom-db-"));
    try {
      const path = join(root, "headroom.db");
      // Roll a fresh database back to before 0007 and store a rule the 0.1 way.
      const before = openDatabase({ path }).sqlite;
      before.run("ALTER TABLE auto_reset_rules DROP COLUMN before_expiry");
      before.run("ALTER TABLE auto_reset_rules DROP COLUMN before_expiry_minutes");
      before.run("DELETE FROM headroom_migrations WHERE name = '0007_expiry_reset'");
      before.run(
        "INSERT INTO connections (id, provider, provider_account_id, scope, label, auth_method, state, interface, connector_version) VALUES ('c1', 'codex', 'a', 'individual', 'A', 'cli_login', 'ready', 'private', '1')",
      );
      before.run(
        "INSERT INTO auto_reset_rules (connection_id, enabled, window, threshold_percent, min_hours_left) VALUES ('c1', 0, 'weekly', 100, 24)",
      );
      before.close();

      const { db, sqlite } = openDatabase({ path });
      expect(db.select().from(schema.autoResetRules).get()).toMatchObject({
        connectionId: "c1",
        enabled: false,
        beforeExpiry: true,
        beforeExpiryMinutes: 2,
      });
      sqlite.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
