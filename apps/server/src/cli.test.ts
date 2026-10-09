import { expect, test } from "bun:test";

import { parseArgs, pathsText, usageText } from "./cli.ts";

const paths = { dataDir: "/d/data", masterKeyFile: "/c/key", authSecretFile: "/c/secret" };

test("no arguments and `start` run the server", () => {
  expect(parseArgs([])).toEqual({ ok: true, command: { kind: "start", open: false } });
  expect(parseArgs(["start"])).toEqual({ ok: true, command: { kind: "start", open: false } });
});

test("start flags override port and host and can open the browser", () => {
  expect(parseArgs(["start", "--port", "9000", "--host", "0.0.0.0", "--open"])).toEqual({
    ok: true,
    command: { kind: "start", open: true, port: 9000, host: "0.0.0.0" },
  });
  expect(parseArgs(["--port", "18778"])).toEqual({
    ok: true,
    command: { kind: "start", open: false, port: 18778 },
  });
});

test("version, help, paths and service commands", () => {
  expect(parseArgs(["--version"])).toEqual({ ok: true, command: { kind: "version" } });
  expect(parseArgs(["--help"])).toEqual({ ok: true, command: { kind: "help" } });
  expect(parseArgs(["paths"])).toEqual({ ok: true, command: { kind: "paths" } });
  expect(parseArgs(["service", "install"])).toEqual({
    ok: true,
    command: { kind: "service", action: "install" },
  });
  expect(parseArgs(["service", "status"])).toEqual({
    ok: true,
    command: { kind: "service", action: "status" },
  });
});

test("unknown commands, flags and bad values are errors", () => {
  for (const args of [
    ["nope"],
    ["--wat"],
    ["--port"],
    ["--port", "0"],
    ["--port", "abc"],
    ["--host"],
    ["service"],
    ["service", "restart"],
    ["service", "install", "x"],
    ["paths", "x"],
  ]) {
    expect(parseArgs(args).ok).toBe(false);
  }
});

test("help and paths text show the resolved locations", () => {
  expect(pathsText(paths)).toBe("data:   /d/data\nkey:    /c/key\nsecret: /c/secret\n");
  const usage = usageText(paths);
  expect(usage).toContain("service install");
  expect(usage).toContain("/c/key");
});
