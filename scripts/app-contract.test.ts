import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appContract, syncAppContract } from "./app-contract.ts";

describe("Mac OpenAPI contract", () => {
  test("committed contract is deterministic and current", async () => {
    expect(await appContract()).toBe(await appContract());
    expect(await syncAppContract(true)).toBe(true);
    const text = await appContract();
    expect(text).toContain('"openapi": "3.1.0"');
    for (const path of ["/api/app/v1/feed", "/api/app/v1/whoami"])
      expect(text).toContain(`"${path}"`);
    for (const status of ["304", "400", "401", "405", "429"]) expect(text).toContain(`"${status}"`);
    expect(text).toContain('"scheme": "bearer"');
    expect(text).toContain('"additionalProperties": false');
  });

  test("check detects a missing or stale file without writing; write repairs it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "headroom-contract-"));
    const path = join(directory, "openapi.json");
    try {
      expect(await syncAppContract(true, path)).toBe(false);
      expect(await syncAppContract(false, path)).toBe(true);
      expect(await syncAppContract(true, path)).toBe(true);
      await writeFile(path, '{"stale":true}\n');
      expect(await syncAppContract(true, path)).toBe(false);
      expect(await readFile(path, "utf8")).toBe('{"stale":true}\n');
      await syncAppContract(false, path);
      expect(await syncAppContract(true, path)).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
