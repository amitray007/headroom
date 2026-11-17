import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bindFirstFree, LEGACY_PORT, portCandidates, resolveCandidates, savePort } from "./port.ts";

const range = Array.from({ length: 20 }, (_, i) => 4323 + i);

describe("portCandidates", () => {
  test("an explicit port is the only candidate", () => {
    expect(portCandidates({ explicit: 8080, saved: 4330, hasDatabase: true })).toEqual([8080]);
  });

  test("a fresh install tries 4323 to 4342", () => {
    expect(portCandidates({ hasDatabase: false })).toEqual(range);
  });

  test("the saved port goes first", () => {
    expect(portCandidates({ saved: 4330, hasDatabase: true })).toEqual([
      4330,
      ...range.filter((p) => p !== 4330),
    ]);
    expect(portCandidates({ saved: 9000, hasDatabase: false })).toEqual([9000, ...range]);
  });

  test("an install from before D49 tries 8080 first", () => {
    expect(portCandidates({ hasDatabase: true })).toEqual([LEGACY_PORT, ...range]);
  });
});

describe("resolveCandidates", () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "headroom-port-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("reads the saved port and the database from the data directory", () => {
    const fresh = tempDir();
    expect(resolveCandidates(fresh, undefined)).toEqual(range);
    const legacy = tempDir();
    writeFileSync(join(legacy, "headroom.db"), "");
    expect(resolveCandidates(legacy, undefined)[0]).toBe(LEGACY_PORT);
    writeFileSync(join(legacy, "port"), "4331\n");
    expect(resolveCandidates(legacy, undefined)[0]).toBe(4331);
  });

  test("ignores a port file that is not a port", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "port"), "nonsense");
    expect(resolveCandidates(dir, undefined)).toEqual(range);
  });

  test("savePort creates the data directory and writes the port", () => {
    const dir = join(tempDir(), "data");
    expect(savePort(dir, 4325)).toBeUndefined();
    expect(readFileSync(join(dir, "port"), "utf8")).toBe("4325\n");
    rmSync(join(dir, "port"));
    mkdirSync(join(dir, "port"));
    expect(savePort(dir, 4326)).toBeInstanceOf(Error);
  });
});

const freePort = () => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = probe.port ?? 0;
  void probe.stop(true);
  return port;
};

describe("bindFirstFree", () => {
  const open: { stop: (force?: boolean) => unknown }[] = [];
  afterEach(() => {
    for (const server of open.splice(0)) void server.stop(true);
  });
  /** Bun's default host is dual-stack "localhost", as a Docker or dev server would listen. */
  const occupy = (port: number, hostname?: string) => {
    open.push(Bun.serve({ port, ...(hostname ? { hostname } : {}), fetch: () => new Response() }));
  };

  test("skips a busy port, binds the next and saves it", async () => {
    const busyPort = freePort();
    occupy(busyPort);
    const nextPort = freePort();
    const { server, port } = await bindFirstFree([busyPort, nextPort], "127.0.0.1");
    open.push(server);
    expect(port).toBe(nextPort);
    const dir = mkdtempSync(join(tmpdir(), "headroom-port-"));
    try {
      expect(savePort(dir, port)).toBeUndefined();
      expect(resolveCandidates(dir, undefined)[0]).toBe(nextPort);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an explicit busy port fails", async () => {
    const busyPort = freePort();
    occupy(busyPort, "127.0.0.1");
    const failure = await bindFirstFree([busyPort], "127.0.0.1").then(() => null, String);
    expect(failure).not.toBeNull();
  });

  test("names the range and HEADROOM_PORT when no candidate is free", async () => {
    const busyPort = freePort();
    occupy(busyPort);
    const failure = await bindFirstFree([busyPort, busyPort], "127.0.0.1").then(() => "", String);
    expect(failure).toMatch(/4323 to 4342.*HEADROOM_PORT/);
  });

  test("answers 503 until the app takes over", async () => {
    const { server, port } = await bindFirstFree([freePort()], "127.0.0.1");
    open.push(server);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(503);
  });
});
