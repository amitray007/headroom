import { describe, expect, test } from "bun:test";

import { resetCreditsUrl, tokenUrl, usageUrl } from "./endpoints.ts";
import resetCreditsFixture from "./fixtures/reset-credits.json";
import usagePartial from "./fixtures/usage-partial.json";
import usageFixture from "./fixtures/usage.json";
import usageLiveShape from "./fixtures/usage-live-shape.json";
import { createCodexConnector, credentialFromAuthFile, parseDeviceStep } from "./index.ts";
import {
  accessToken,
  accountId,
  authFile,
  fakeFetch,
  FakeRunner,
  idToken,
  json,
} from "./test-support.ts";

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

function usageConnector(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  return createCodexConnector({
    runner: new FakeRunner(),
    fetch: fakeFetch({ [usageUrl]: () => json(body, status, headers) }).fetch,
  });
}

function tokenConnector(response: () => Response | Promise<Response>) {
  return createCodexConnector({
    runner: new FakeRunner(),
    fetch: fakeFetch({ [tokenUrl]: response }).fetch,
  });
}

const identity = {
  providerAccountId: accountId,
  workspaceId: null,
  label: "x",
  assurance: "strong" as const,
};

const deviceOutput = `
Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   https://auth.openai.com/codex/device

2. Enter this one-time code (expires in 15 minutes)
   ABCD-EFGHJ
`;

describe("device output parsing", () => {
  test("finds the URL and code the CLI prints", () => {
    expect(parseDeviceStep(deviceOutput)).toEqual({
      url: "https://auth.openai.com/codex/device",
      code: "ABCD-EFGHJ",
    });
    expect(parseDeviceStep("Welcome to Codex")).toBeNull();
  });
});

describe("auth file", () => {
  test("accepts the CLI's auth.json and derives expiry and account id", () => {
    const credential = credentialFromAuthFile(authFile());
    expect(credential.expiresAt).toBe(1_700_003_600_000);
    expect(credential.secret).toMatchObject({ accountId, refreshToken: "refresh-synthetic" });
  });

  test("rejects non-JSON, API-key-only files and missing tokens", () => {
    expect(() => credentialFromAuthFile("not json")).toThrow(/not JSON/);
    expect(() => credentialFromAuthFile(JSON.stringify({ OPENAI_API_KEY: "sk-x" }))).toThrow(
      /auth\.json/,
    );
    expect(() =>
      credentialFromAuthFile(JSON.stringify({ tokens: { access_token: "a" } })),
    ).toThrow();
  });
});

describe("cli_login flow", () => {
  test("begin starts the CLI and returns the device code; poll waits, then yields credentials and cleans up", async () => {
    const runner = new FakeRunner();
    runner.output = deviceOutput;
    const connector = createCodexConnector({
      runner,
      fetch: fakeFetch({}).fetch,
      now: () => 1_700_000_000_000,
    });
    const begun = await connector.beginConnect({
      attemptId: "a1",
      method: "cli_login",
      expiresAt: 1_700_000_900_000,
    });
    expect(begun.status).toBe("next_step");
    if (begun.status !== "next_step") throw new Error("unreachable");
    expect(begun.nextStep).toMatchObject({ kind: "device_code", userCode: "ABCD-EFGHJ" });
    expect(runner.started).toEqual(["a1"]);

    const waiting = await connector.pollConnect(begun.privateState);
    expect(waiting.status).toBe("waiting");

    runner.credentials = authFile();
    const done = await connector.pollConnect(begun.privateState);
    expect(done.status).toBe("credentials");
    expect(runner.cleaned).toEqual(["a1"]);
  });

  test("a CLI that exits without credentials is a denied approval; a timeout is an expired approval", async () => {
    const runner = new FakeRunner();
    const connector = createCodexConnector({ runner, fetch: fakeFetch({}).fetch });
    runner.state = "exited";
    const exited = await connector.pollConnect({ attemptId: "a2" });
    expect(exited).toMatchObject({ status: "error", error: { category: "approval_denied" } });
    runner.state = "timed_out";
    const timedOut = await connector.pollConnect({ attemptId: "a3" });
    expect(timedOut).toMatchObject({ status: "error", error: { category: "approval_expired" } });
  });

  test("import: paste_file step, then a pasted auth.json becomes credentials", async () => {
    const connector = createCodexConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({}).fetch,
    });
    const begun = await connector.beginConnect({ attemptId: "a4", method: "import", expiresAt: 1 });
    expect(begun).toMatchObject({
      status: "next_step",
      nextStep: { kind: "paste_file", expectedFileName: "auth.json" },
    });
    expect(
      await connector.submitInput({ attemptId: "a4" }, { kind: "file", contents: authFile() }),
    ).toMatchObject({
      status: "credentials",
    });
    expect(
      await connector.submitInput({ attemptId: "a4" }, { kind: "file", contents: "nope" }),
    ).toMatchObject({
      status: "error",
      error: { category: "invalid_response", class: "capability" },
    });
  });
});

describe("identity and collection", () => {
  const credential = credentialFromAuthFile(authFile());

  test("identity comes from the id token claims", async () => {
    const connector = createCodexConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({}).fetch,
    });
    expect(await connector.identity(credential)).toEqual({
      providerAccountId: accountId,
      workspaceId: null,
      label: "owner@example.com (pro)",
      assurance: "strong",
    });
    const noAccount = {
      secret: {
        ...credential.secret,
        accountId: null,
        idToken: idToken({ "https://api.openai.com/auth": {} }),
      },
      expiresAt: null,
    };
    expect(String(await rejection(connector.identity(noAccount)))).toMatch(/account id/);
  });

  test("collect maps windows, additional limits, credits and reset credits; sends the account header", async () => {
    const http = fakeFetch({
      [usageUrl]: () => json(usageFixture),
      [resetCreditsUrl]: () => json(resetCreditsFixture),
    });
    const connector = createCodexConnector({
      runner: new FakeRunner(),
      fetch: http.fetch,
      now: () => 1_700_000_000_000,
    });
    const result = await connector.collect(credential, await connector.identity(credential));
    expect(result.failures).toEqual([]);
    expect(http.calls).toEqual([usageUrl, resetCreditsUrl]);
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["rate_limit.primary_window"]).toMatchObject({
      valueText: "23.5",
      scope: "window:18000s",
      resetsAt: 1_700_003_600_000,
    });
    expect(byKey["rate_limit.secondary_window"]).toMatchObject({
      valueText: "41",
      scope: "window:604800s",
    });
    expect(byKey["additional.GPT-5.3-Codex-Spark.primary_window"]).toMatchObject({
      valueText: "5",
    });
    expect(byKey["credits.balance"]).toMatchObject({
      valueText: "12.5",
      unit: "codex_credits",
      kind: "credits",
    });
    expect(byKey["reset_credits.available_count"]).toMatchObject({
      valueText: "2",
      kind: "reset_inventory",
    });
    expect(result.resetCredits).toEqual([
      {
        providerCreditId: "rc_1",
        eligible: true,
        usable: true,
        expiresAt: 1_702_592_000_000,
        rawLabel: "available",
      },
      {
        providerCreditId: "rc_2",
        eligible: false,
        usable: false,
        expiresAt: Date.parse("2026-12-31T00:00:00Z"),
        rawLabel: "cooldown",
      },
    ]);
  });

  test("the live response shape of 2026-10-01 parses: null secondary window and null additional limits", async () => {
    const http = fakeFetch({
      [usageUrl]: () => json(usageLiveShape),
      [resetCreditsUrl]: () => json({ detail: "not found" }, 404),
    });
    const connector = createCodexConnector({ runner: new FakeRunner(), fetch: http.fetch });
    const result = await connector.collect(credential, identity);
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["rate_limit.primary_window"]).toMatchObject({
      valueText: "16",
      scope: "window:604800s",
      resetsAt: 1791441507000,
      availability: "available",
    });
    expect(Object.keys(byKey)).not.toContain("rate_limit.secondary_window");
    expect(byKey["credits.balance"]).toMatchObject({ valueText: "1234.5678", unlimited: false });
    expect(byKey["reset_credits.available_count"]).toMatchObject({ valueText: "3" });
    expect(result.failures).toHaveLength(1);
  });

  test("missing percentages are unknown, not zero; a failing reset-credits route is a capability failure", async () => {
    const http = fakeFetch({
      [usageUrl]: () => json(usagePartial),
      [resetCreditsUrl]: () => new Response("boom", { status: 500 }),
    });
    const connector = createCodexConnector({ runner: new FakeRunner(), fetch: http.fetch });
    const result = await connector.collect(credential, await connector.identity(credential));
    const primary = result.metrics.find((m) => m.providerMetricKey === "rate_limit.primary_window");
    expect(primary).toMatchObject({ valueText: null, availability: "unknown" });
    expect(result.metrics.find((m) => m.providerMetricKey === "credits.balance")).toMatchObject({
      availability: "unknown",
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.class).toBe("transient");
  });

  test("401 is authentication_required, 429 carries Retry-After, drift is invalid_response", async () => {
    expect(await rejection(usageConnector(401).collect(credential, identity))).toMatchObject({
      category: "authentication_required",
    });
    expect(
      await rejection(
        usageConnector(429, {}, { "retry-after": "30" }).collect(credential, identity),
      ),
    ).toMatchObject({
      category: "rate_limited",
      retryAfterMs: 30_000,
    });
    expect(
      await rejection(
        usageConnector(200, { rate_limit: "not an object" }).collect(credential, identity),
      ),
    ).toMatchObject({ category: "invalid_response" });
  });
});

describe("refresh", () => {
  const credential = credentialFromAuthFile(authFile());

  test("a successful refresh rotates tokens and recomputes expiry", async () => {
    const connector = tokenConnector(() =>
      json({
        access_token: accessToken(1_700_007_200),
        refresh_token: "refresh-2",
        id_token: idToken(),
      }),
    );
    const result = await connector.refresh(credential);
    expect(result).toMatchObject({
      status: "refreshed",
      credential: {
        expiresAt: 1_700_007_200_000,
        secret: { refreshToken: "refresh-2", accountId },
      },
    });
  });

  test("invalid_grant and reused tokens are rejected; 5xx and network errors are transient", async () => {
    expect(
      await tokenConnector(() => json({ error: "invalid_grant" }, 400)).refresh(credential),
    ).toMatchObject({
      status: "rejected",
    });
    expect(
      await tokenConnector(() => json({ error: "refresh_token_reused" }, 403)).refresh(credential),
    ).toMatchObject({
      status: "rejected",
    });
    expect(await tokenConnector(() => json({}, 503)).refresh(credential)).toMatchObject({
      status: "transient",
    });
    expect(
      await tokenConnector(() => Promise.reject(new Error("ECONNRESET"))).refresh(credential),
    ).toMatchObject({
      status: "transient",
    });
  });

  test("disconnect is local only", async () => {
    const connector = createCodexConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({}).fetch,
    });
    expect(await connector.disconnect(credential)).toBe("local_only");
  });
});
