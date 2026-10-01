import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { CliLoginStatus, LoginRunner } from "@headroom/core";

import { profileUrl, tokenUrl, usageUrl } from "./endpoints.ts";
import usageLiveShape from "./fixtures/usage-live-shape.json";
import usageMinimal from "./fixtures/usage-minimal.json";
import usageFixture from "./fixtures/usage.json";
import {
  codeFromInput,
  createClaudeConnector,
  credentialFromCredentialsFile,
  parseAuthorizeUrl,
} from "./index.ts";

const credentialsFile = JSON.stringify({
  claudeAiOauth: {
    accessToken: "access-synthetic",
    refreshToken: "refresh-synthetic",
    expiresAt: 1_700_003_600_000,
    scopes: ["user:profile", "user:inference"],
    subscriptionType: "max",
  },
});

class FakeRunner implements LoginRunner {
  readonly started: string[] = [];
  readonly cleaned: string[] = [];
  readonly written: string[] = [];
  output = "";
  state: CliLoginStatus["state"] = "running";
  credentials: string | null = null;
  start(spec: { attemptId: string }): void {
    this.started.push(spec.attemptId);
  }
  status(): CliLoginStatus {
    return {
      state: this.state,
      exitCode: null,
      output: this.output,
      credentialsPresent: this.credentials !== null,
    };
  }
  readCredentials(): string | null {
    return this.credentials;
  }
  cleanup(id: string): Promise<void> {
    this.cleaned.push(id);
    return Promise.resolve();
  }
  kill(): Promise<void> {
    return Promise.resolve();
  }
  write(_id: string, line: string): void {
    this.written.push(line);
    // The real CLI exchanges the code and writes the file; the fake does it at once.
    this.credentials = credentialsFile;
  }
}

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (url: string, init?: RequestInit) => {
    calls.push(init ? { url, init } : { url });
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    return Promise.resolve(match ? routes[match]!() : new Response("nf", { status: 404 }));
  };
  return { fetch: impl, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const cliOutput = `Opening browser to sign in…
If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=abc
Paste code here if prompted > `;

const profile = {
  account: { uuid: "acct-uuid", email: "owner@example.com" },
  organization: { uuid: "org-uuid", name: "Personal" },
};
const identity = {
  providerAccountId: "acct-uuid",
  workspaceId: "org-uuid",
  label: "x",
  assurance: "strong" as const,
};

describe("Claude connector", () => {
  test("parses the authorization URL and normalizes pasted codes and redirect URLs", () => {
    expect(parseAuthorizeUrl(cliOutput)).toContain(
      "https://claude.com/cai/oauth/authorize?code=true",
    );
    expect(parseAuthorizeUrl("nothing")).toBeNull();
    expect(codeFromInput({ kind: "code", value: " abc#def " })).toBe("abc#def");
    expect(
      codeFromInput({
        kind: "redirect",
        value: "http://localhost:1234/callback?code=abc&state=def",
      }),
    ).toBe("abc#def");
    expect(codeFromInput({ kind: "redirect", value: "not a url" })).toBeNull();
    expect(codeFromInput({ kind: "selection", id: "x" })).toBeNull();
  });

  test("credentials file yields a credential with expiry and plan", () => {
    const credential = credentialFromCredentialsFile(credentialsFile);
    expect(credential.expiresAt).toBe(1_700_003_600_000);
    expect(credential.secret).toMatchObject({
      refreshToken: "refresh-synthetic",
      subscriptionType: "max",
    });
    expect(() => credentialFromCredentialsFile(JSON.stringify({ other: 1 }))).toThrow(
      /credentials\.json/,
    );
  });

  test("cli login: URL step, pasted code is written to the CLI, credentials follow", async () => {
    const runner = new FakeRunner();
    runner.output = cliOutput;
    const connector = createClaudeConnector({
      runner,
      fetch: fakeFetch({}).fetch,
      now: () => 1_700_000_000_000,
    });
    const begun = await connector.beginConnect({
      attemptId: "c1",
      method: "cli_login",
      expiresAt: 1_700_000_900_000,
    });
    expect(begun).toMatchObject({
      status: "next_step",
      nextStep: { kind: "paste_redirect", accepts: "url_or_code" },
      pollAfterMs: 2000,
    });
    expect((await connector.pollConnect({ attemptId: "c1" })).status).toBe("waiting");
    const done = await connector.submitInput(
      { attemptId: "c1" },
      { kind: "code", value: "code#state" },
    );
    expect(runner.written).toEqual(["code#state"]);
    expect(done.status).toBe("credentials");
    expect(runner.cleaned).toEqual(["c1"]);
  });

  test("cli login: a poll finds credentials the CLI wrote on its own, with no pasted code", async () => {
    const runner = new FakeRunner();
    runner.output = cliOutput;
    const connector = createClaudeConnector({ runner, fetch: fakeFetch({}).fetch });
    await connector.beginConnect({
      attemptId: "c2",
      method: "cli_login",
      expiresAt: Date.now() + 60_000,
    });
    runner.credentials = credentialsFile;
    const done = await connector.pollConnect({ attemptId: "c2" });
    expect(done.status).toBe("credentials");
    expect(runner.written).toEqual([]);
    expect(runner.cleaned).toEqual(["c2"]);
  });

  test("identity reads the profile with the OAuth beta header", async () => {
    const http = fakeFetch({ [profileUrl]: () => json(profile) });
    const connector = createClaudeConnector({ runner: new FakeRunner(), fetch: http.fetch });
    expect(await connector.identity(credentialFromCredentialsFile(credentialsFile))).toEqual({
      providerAccountId: "acct-uuid",
      workspaceId: "org-uuid",
      label: "owner@example.com (max)",
      assurance: "strong",
    });
    const headers = z.record(z.string(), z.string()).parse(http.calls[0]?.init?.headers);
    expect(headers["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(headers["authorization"]).toBe("Bearer access-synthetic");
  });

  test("collect maps windows, scoped limits, extra usage in dollars and reset grants", async () => {
    const connector = createClaudeConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({ [usageUrl]: () => json(usageFixture) }).fetch,
      now: () => 1_700_000_000_000,
    });
    const result = await connector.collect(
      credentialFromCredentialsFile(credentialsFile),
      identity,
    );
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["five_hour"]).toMatchObject({
      valueText: "23",
      scope: "window:18000s",
      resetsAt: Date.parse("2026-10-01T18:00:00Z"),
    });
    expect(byKey["seven_day"]).toMatchObject({ valueText: "41.5" });
    expect(byKey["seven_day_sonnet"]).toMatchObject({ valueText: "3" });
    expect(byKey["limits.Fable"]).toMatchObject({ valueText: "12", kind: "quota_percentage" });
    expect(byKey["extra_usage.used"]).toMatchObject({
      valueText: "12.50",
      unit: "USD",
      kind: "spend",
    });
    expect(byKey["extra_usage.monthly_limit"]).toMatchObject({
      valueText: "50.00",
      kind: "spending_cap",
    });
    expect(byKey["reset_grants.available"]).toMatchObject({
      valueText: "2",
      kind: "reset_inventory",
    });
    expect(result.resetCredits).toHaveLength(2);
    expect(result.resetCredits?.[0]).toMatchObject({
      usable: true,
      expiresAt: Date.parse("2026-10-31T00:00:00Z"),
    });
    expect(result.resetCredits?.[1]).toMatchObject({ usable: false });
    expect(Object.keys(byKey)).not.toContain("limits.scoped");
  });

  test("the live response shape of 2026-10-01 parses: null scopes, null extra-usage amounts, empty grants", async () => {
    const connector = createClaudeConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({ [usageUrl]: () => json(usageLiveShape) }).fetch,
    });
    const result = await connector.collect(
      credentialFromCredentialsFile(credentialsFile),
      identity,
    );
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["five_hour"]).toMatchObject({ valueText: "69", availability: "available" });
    expect(byKey["seven_day"]).toMatchObject({ valueText: "62", availability: "available" });
    expect(byKey["limits.Fable"]).toMatchObject({ valueText: "0", availability: "available" });
    expect(Object.keys(byKey)).not.toContain("extra_usage.used");
    expect(Object.keys(byKey)).not.toContain("extra_usage.monthly_limit");
    expect(Object.keys(byKey)).not.toContain("seven_day_sonnet");
    expect(result.metrics.every((m) => m.availability === "available")).toBe(true);
    expect(result.resetCredits).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  test("missing utilization is unknown, disabled extra usage emits nothing, ineligible grants count zero", async () => {
    const connector = createClaudeConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({ [usageUrl]: () => json(usageMinimal) }).fetch,
    });
    const result = await connector.collect(
      credentialFromCredentialsFile(credentialsFile),
      identity,
    );
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["five_hour"]).toMatchObject({ valueText: null, availability: "unknown" });
    expect(byKey["seven_day"]).toMatchObject({ valueText: "0", availability: "available" });
    expect(Object.keys(byKey)).not.toContain("extra_usage.used");
    expect(byKey["reset_grants.available"]).toMatchObject({ valueText: "0" });
  });

  test("refresh posts JSON with the public client id; rejections are definitive", async () => {
    const http = fakeFetch({
      [tokenUrl]: () =>
        json({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }),
    });
    const connector = createClaudeConnector({
      runner: new FakeRunner(),
      fetch: http.fetch,
      now: () => 1_700_000_000_000,
    });
    const refreshed = await connector.refresh(credentialFromCredentialsFile(credentialsFile));
    expect(refreshed).toMatchObject({
      status: "refreshed",
      credential: { expiresAt: 1_700_003_600_000, secret: { refreshToken: "refresh-2" } },
    });
    const body = z
      .record(z.string(), z.string())
      .parse(JSON.parse(z.string().parse(http.calls[0]?.init?.body)));
    expect(body["client_id"]).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
    expect(body["grant_type"]).toBe("refresh_token");
    const rejected = createClaudeConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({ [tokenUrl]: () => json({ error: "invalid_grant" }, 400) }).fetch,
    });
    expect(await rejected.refresh(credentialFromCredentialsFile(credentialsFile))).toMatchObject({
      status: "rejected",
    });
  });
});
