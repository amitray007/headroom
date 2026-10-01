import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "@headroom/core";

import { describeDatabase } from "./app.ts";
import { bootstrap, loadOrCreateKeyring } from "./bootstrap.ts";

describe("bootstrap", () => {
  test("creates a 0600 key file once and reuses it", () => {
    const dir = mkdtempSync(join(tmpdir(), "headroom-"));
    try {
      const path = join(dir, "keys", "headroom.key");
      const messages: string[] = [];
      const first = loadOrCreateKeyring(path, (_level, message) => messages.push(message));
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readFileSync(path, "utf8").trim()).toHaveLength(64);
      expect(messages[0]).toContain("back it up");
      const second = loadOrCreateKeyring(path, () => undefined);
      expect(second.keys.get(1)).toEqual(first.keys.get(1));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("opens the database under the data dir and applies migrations", () => {
    const dir = mkdtempSync(join(tmpdir(), "headroom-"));
    try {
      const ctx = bootstrap({
        config: loadConfig({
          HEADROOM_DATA_DIR: join(dir, "data"),
          HEADROOM_MASTER_KEY_FILE: join(dir, "key"),
        }),
      });
      expect(describeDatabase(ctx).migrations).toEqual(["0000_init"]);
      expect(statSync(join(dir, "data", "headroom.db")).isFile()).toBe(true);
      expect(ctx.owner.hasOwner()).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
