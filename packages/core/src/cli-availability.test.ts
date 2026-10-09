import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cliAvailability } from "./cli-availability.ts";

describe("cliAvailability", () => {
  test("finds a bare name on PATH", () => {
    const found = cliAvailability("cli_login", "codex", "sh");
    expect(found).toEqual({ method: "cli_login", available: true, reason: null, cli: "codex" });
  });

  test("reports a missing bare name with the CLI to install", () => {
    const found = cliAvailability("cli_login", "codex", "headroom-no-such-cli");
    expect(found).toEqual({
      method: "cli_login",
      available: false,
      reason: "cli_not_installed",
      cli: "codex",
    });
  });

  test("accepts an absolute executable and rejects a missing or non-executable path", () => {
    const dir = mkdtempSync(join(tmpdir(), "headroom-avail-"));
    try {
      const good = join(dir, "codex");
      writeFileSync(good, "#!/bin/sh\n");
      chmodSync(good, 0o755);
      const plain = join(dir, "plain");
      writeFileSync(plain, "x");
      chmodSync(plain, 0o644);
      expect(cliAvailability("cli_login", "codex", good).available).toBe(true);
      expect(cliAvailability("cli_login", "codex", plain).available).toBe(false);
      expect(cliAvailability("cli_login", "codex", join(dir, "gone")).available).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("other methods never need the CLI", () => {
    const found = cliAvailability("import", "codex", "headroom-no-such-cli");
    expect(found).toEqual({ method: "import", available: true, reason: null, cli: null });
  });
});
