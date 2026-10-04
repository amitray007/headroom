import { describe, expect, test } from "bun:test";

import { awaitCliStep, finishCliLogin } from "./cli-login.ts";
import type { CliLoginStatus, LoginRunner } from "./cli-runner.ts";
import { ConnectorError } from "./connector.ts";
import type { StoredCredential } from "./credentials.ts";

/** A runner whose status comes from a script; records cleanups. */
function fakeRunner(statuses: (CliLoginStatus | null)[], credentials: string | null = null) {
  const cleaned: string[] = [];
  let reads = 0;
  const runner: LoginRunner = {
    start: () => undefined,
    status: () => statuses[Math.min(reads++, statuses.length - 1)] ?? null,
    write: () => undefined,
    readCredentials: () => credentials,
    kill: () => Promise.resolve(),
    cleanup: (id) => {
      cleaned.push(id);
      return Promise.resolve();
    },
  };
  return { runner, cleaned };
}

const running = (output = ""): CliLoginStatus => ({
  state: "running",
  exitCode: null,
  output,
  credentialsPresent: false,
});

const credential: StoredCredential = { secret: { token: "synthetic" }, expiresAt: null };
const options = {
  parse: (contents: string): StoredCredential => {
    if (contents === "bad") throw new ConnectorError("invalid_response", "not a file");
    return credential;
  },
  pollAfterMs: 1234,
  expiredMessage: "expired in words",
};

describe("finishCliLogin", () => {
  test("a missing process is an expired approval and nothing to clean", async () => {
    const { runner, cleaned } = fakeRunner([null]);
    const progress = await finishCliLogin(runner, "a1", options);
    expect(progress).toMatchObject({
      status: "error",
      error: { category: "approval_expired", message: "the sign-in process is gone" },
    });
    expect(cleaned).toEqual([]);
  });

  test("credentials are parsed, and the attempt is cleaned", async () => {
    const { runner, cleaned } = fakeRunner(
      [{ ...running(), credentialsPresent: true }],
      "contents",
    );
    expect(await finishCliLogin(runner, "a1", options)).toEqual({
      status: "credentials",
      credential,
    });
    expect(cleaned).toEqual(["a1"]);
  });

  test("credentials win over an exited state", async () => {
    const { runner } = fakeRunner(
      [{ state: "exited", exitCode: 0, output: "", credentialsPresent: true }],
      "contents",
    );
    expect((await finishCliLogin(runner, "a1", options)).status).toBe("credentials");
  });

  test("a credentials file that disappears is an internal error, still cleaned", async () => {
    const { runner, cleaned } = fakeRunner([{ ...running(), credentialsPresent: true }], null);
    expect(await finishCliLogin(runner, "a1", options)).toMatchObject({
      status: "error",
      error: { category: "internal_error", message: "credentials file vanished" },
    });
    expect(cleaned).toEqual(["a1"]);
  });

  test("a parser failure is classified, never thrown, and the attempt is cleaned", async () => {
    const { runner, cleaned } = fakeRunner([{ ...running(), credentialsPresent: true }], "bad");
    expect(await finishCliLogin(runner, "a1", options)).toMatchObject({
      status: "error",
      error: { category: "invalid_response", message: "not a file" },
    });
    expect(cleaned).toEqual(["a1"]);
  });

  test("a timeout uses the caller's message", async () => {
    const { runner, cleaned } = fakeRunner([
      { state: "timed_out", exitCode: null, output: "", credentialsPresent: false },
    ]);
    expect(await finishCliLogin(runner, "a1", options)).toMatchObject({
      status: "error",
      error: { category: "approval_expired", message: "expired in words" },
    });
    expect(cleaned).toEqual(["a1"]);
  });

  test.each(["exited", "killed"] as const)(
    "%s without credentials is a denied approval",
    async (state) => {
      const { runner, cleaned } = fakeRunner([
        { state, exitCode: 1, output: "", credentialsPresent: false },
      ]);
      expect(await finishCliLogin(runner, "a1", options)).toMatchObject({
        status: "error",
        error: { category: "approval_denied", message: "the sign-in did not complete" },
      });
      expect(cleaned).toEqual(["a1"]);
    },
  );

  test("a running CLI keeps waiting at the caller's interval, with the attempt kept", async () => {
    const { runner, cleaned } = fakeRunner([running()]);
    expect(await finishCliLogin(runner, "a1", options)).toEqual({
      status: "waiting",
      privateState: { attemptId: "a1" },
      pollAfterMs: 1234,
    });
    expect(cleaned).toEqual([]);
  });
});

const parse = (output: string): string | null => /CODE-\d+/.exec(output)?.[0] ?? null;

describe("awaitCliStep", () => {
  test("returns a step already in the output without waiting", async () => {
    const { runner, cleaned } = fakeRunner([running("hello CODE-1")]);
    const step = await awaitCliStep(runner, "a1", { parse, now: () => 0, timeoutMs: 1000 });
    expect(step).toBe("CODE-1");
    expect(cleaned).toEqual([]);
  });

  test("polls until the step shows up", async () => {
    const { runner, cleaned } = fakeRunner([running(""), running("starting"), running("CODE-2")]);
    const step = await awaitCliStep(runner, "a1", {
      parse,
      now: () => 0,
      timeoutMs: 1000,
      pollMs: 1,
    });
    expect(step).toBe("CODE-2");
    expect(cleaned).toEqual([]);
  });

  test("gives up at the deadline and removes the attempt", async () => {
    const { runner, cleaned } = fakeRunner([running("")]);
    let clock = 0;
    const step = await awaitCliStep(runner, "a1", {
      parse,
      now: () => (clock += 600),
      timeoutMs: 1000,
      pollMs: 1,
    });
    expect(step).toBeNull();
    expect(cleaned).toEqual(["a1"]);
  });

  test.each([
    ["vanishes", null],
    ["exits", { state: "exited", exitCode: 1, output: "", credentialsPresent: false } as const],
  ])("stops early when the CLI %s, and removes the attempt", async (_name, gone) => {
    const { runner, cleaned } = fakeRunner([running(""), gone]);
    const step = await awaitCliStep(runner, "a1", {
      parse,
      now: () => 0,
      timeoutMs: 1000,
      pollMs: 1,
    });
    expect(step).toBeNull();
    expect(cleaned).toEqual(["a1"]);
  });
});
