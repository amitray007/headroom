import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, ownerExists } from "@headroom/core";
import { credentialFixture } from "@headroom/core/testing";

import { describeDatabase } from "./app.ts";
import { bootstrap, loadOrCreateSecretFile } from "./bootstrap.ts";

describe("bootstrap", () => {
  test("creates a 0600 secret file once and reuses it", () => {
    const dir = mkdtempSync(join(tmpdir(), "headroom-"));
    try {
      const path = join(dir, "keys", "headroom.key");
      const messages: string[] = [];
      const first = loadOrCreateSecretFile(
        path,
        () => "a".repeat(64),
        (_l, m) => messages.push(m),
        "master key",
      );
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readFileSync(path, "utf8").trim()).toBe(first);
      expect(messages[0]).toContain("master key");
      expect(
        loadOrCreateSecretFile(
          path,
          () => "b".repeat(64),
          () => undefined,
          "master key",
        ),
      ).toBe(first);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("opens the database under the data dir, creates both secrets, applies migrations", () => {
    const dir = mkdtempSync(join(tmpdir(), "headroom-"));
    try {
      const ctx = bootstrap({
        config: loadConfig({
          HEADROOM_DATA_DIR: join(dir, "data"),
          HEADROOM_MASTER_KEY_FILE: join(dir, "key"),
          HEADROOM_AUTH_SECRET_FILE: join(dir, "auth"),
        }),
      });
      expect(describeDatabase(ctx).migrations).toEqual([
        "0000_init",
        "0001_names_and_settings",
        "0002_display_order",
        "0003_notification_delivery",
        "0004_wallet",
        "0005_single_owner",
      ]);
      expect(statSync(join(dir, "data", "headroom.db")).isFile()).toBe(true);
      expect(statSync(join(dir, "auth")).mode & 0o777).toBe(0o600);
      expect(ownerExists(ctx.db)).toBe(false);
      expect(ctx.trustedOrigins).toEqual(["http://localhost:8080"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses to create a new master key when the database holds credentials", () => {
    const dir = mkdtempSync(join(tmpdir(), "headroom-"));
    try {
      const config = loadConfig({
        HEADROOM_DATA_DIR: join(dir, "data"),
        HEADROOM_MASTER_KEY_FILE: join(dir, "key"),
        HEADROOM_AUTH_SECRET_FILE: join(dir, "auth"),
      });
      const first = bootstrap({ config });
      // A fresh database with no sealed data may still create its key on first start.
      const connection = first.connections.create({
        provider: "codex",
        identity: { providerAccountId: "a", workspaceId: null, label: "A", assurance: "strong" },
        scope: "individual",
        authMethod: "import",
        interface: "private",
        connectorVersion: "fake-1",
      });
      first.credentials.put(connection.id, credentialFixture());
      first.sqlite.close();
      unlinkSync(join(dir, "key"));
      expect(() => bootstrap({ config })).toThrow(/HEADROOM_MASTER_KEY_FILE/);
      expect(() => bootstrap({ config })).toThrow(join(dir, "key"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("closes sync runs left open by a previous process as interrupted", () => {
    const dir = mkdtempSync(join(tmpdir(), "headroom-"));
    try {
      const config = loadConfig({
        HEADROOM_DATA_DIR: join(dir, "data"),
        HEADROOM_MASTER_KEY_FILE: join(dir, "key"),
        HEADROOM_AUTH_SECRET_FILE: join(dir, "auth"),
      });
      const first = bootstrap({ config });
      const connection = first.connections.create({
        provider: "codex",
        identity: { providerAccountId: "a", workspaceId: null, label: "A", assurance: "strong" },
        scope: "individual",
        authMethod: "import",
        interface: "private",
        connectorVersion: "fake-1",
      });
      const run = first.snapshots.startRun(connection.id);
      first.sqlite.close();
      const second = bootstrap({ config });
      const closed = second.snapshots.latestRun(connection.id);
      expect(closed?.id).toBe(run.id);
      expect(closed?.outcome).toBe("interrupted");
      expect(closed?.finishedAt).not.toBeNull();
      second.sqlite.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
