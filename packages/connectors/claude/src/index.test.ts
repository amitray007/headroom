import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { CliLoginStatus, Identity, LoginRunner } from "@headroom/core";

import {
  claudeCodeUserAgent,
  prepaidCreditsUrl,
  profileUrl,
  tokenUrl,
  usageUrl,
} from "./endpoints.ts";
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

const grant = (over: Record<string, unknown>) => ({
  label: "Synthetic grant",
  resets_total: 1,
  resets_left: 1,
  starts_at: "2026-09-01T00:00:00Z",
  ends_at: "2026-10-20T00:00:00Z",
  paused: false,
  usable_now: true,
  clears: ["five_hour", "seven_day"],
  ...over,
});

async function collectCloud(block: unknown) {
  const connector = createClaudeConnector({
    runner: new FakeRunner(),
    fetch: fakeFetch({ [usageUrl]: () => json({ ...usageMinimal, iguana_necktie: block }) }).fetch,
  });
  const result = await connector.collect(credentialFromCredentialsFile(credentialsFile), identity);
  return Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
}

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

  test("missing utilization is unknown, disabled extra usage emits nothing, ineligible grants emit no count", async () => {
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
    expect(byKey["reset_grants.available"]).toBeUndefined();
  });

  describe("cloud credits", () => {
    test("the live dollar shape of 2026-10-08 gives what is left, the allowance and the expiry", async () => {
      const byKey = await collectCloud({
        utilization: 12,
        resets_at: "2026-11-05T07:59:00+00:00",
        limit_dollars: 250,
        used_dollars: 30,
        remaining_dollars: 220,
        locked_reason: null,
      });
      const expiry = Date.parse("2026-11-05T07:59:00Z");
      expect(byKey["cloud_credits.remaining"]).toMatchObject({
        kind: "currency_balance",
        valueText: "220.00",
        unit: "USD",
        windowEnd: expiry,
        availability: "available",
      });
      expect(byKey["cloud_credits.limit"]).toMatchObject({
        valueText: "250.00",
        windowEnd: expiry,
      });
    });

    test("without remaining_dollars, what is left comes from the allowance and the spend", async () => {
      const byKey = await collectCloud({ limit_dollars: 250, used_dollars: 260 });
      expect(byKey["cloud_credits.remaining"]).toMatchObject({ valueText: "0.00" });
      const unknown = await collectCloud({ limit_dollars: 250 });
      expect(unknown["cloud_credits.remaining"]).toMatchObject({
        valueText: null,
        availability: "unknown",
      });
    });

    test("null, the old percent window, or a strange shape gives nothing and never fails the read", async () => {
      const results = await Promise.all(
        [null, { utilization: 40, resets_at: null }, "credit"].map(collectCloud),
      );
      for (const byKey of results) {
        expect(byKey["cloud_credits.remaining"]).toBeUndefined();
        expect(byKey["seven_day"]).toMatchObject({ availability: "available" });
      }
    });
  });

  describe("usage-credit balance", () => {
    const creditsUrl = prepaidCreditsUrl("org-uuid");
    async function collectCredits(route: () => Response, who: Identity = identity) {
      const http = fakeFetch({ [usageUrl]: () => json(usageMinimal), [creditsUrl]: route });
      const connector = createClaudeConnector({
        runner: new FakeRunner(),
        fetch: http.fetch,
        now: () => Date.parse("2026-10-08T00:00:00Z"),
      });
      const result = await connector.collect(credentialFromCredentialsFile(credentialsFile), who);
      const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
      return { result, byKey, calls: http.calls };
    }

    test("the balance includes promotional credits; the soonest-expiring part is its own metric", async () => {
      const { result, byKey, calls } = await collectCredits(() =>
        json({
          amount: 2500,
          currency: "usd",
          balance: { money: { amount_minor: 2500, currency: "USD", exponent: 2 } },
          next_expires_at: "2026-11-04T00:00:00Z",
          tranches: [{ remaining_amount_minor_units: 1500, expires_at: null }],
          promo_tranches: [
            { remaining_amount_minor_units: 1000, expires_at: "2026-11-04T00:00:00Z" },
          ],
        }),
      );
      expect(byKey["prepaid.balance"]).toMatchObject({
        kind: "currency_balance",
        valueText: "25.00",
        unit: "USD",
        availability: "available",
      });
      expect(byKey["prepaid.expiring"]).toMatchObject({
        kind: "currency_balance",
        valueText: "10.00",
        windowEnd: Date.parse("2026-11-04T00:00:00Z"),
      });
      expect(result.failures).toEqual([]);
      const request = calls.find((call) => call.url === creditsUrl);
      const headers = z.record(z.string(), z.string()).parse(request?.init?.headers);
      expect(headers["x-organization-uuid"]).toBe("org-uuid");
      expect(headers["authorization"]).toBe("Bearer access-synthetic");
    });

    test("the empty live shape of 2026-10-08 is a real zero with nothing expiring", async () => {
      const { result, byKey } = await collectCredits(() =>
        json({
          amount: 0,
          currency: "USD",
          next_expires_at: null,
          tranches: [],
          promo_tranches: [],
        }),
      );
      expect(byKey["prepaid.balance"]).toMatchObject({
        valueText: "0.00",
        availability: "available",
      });
      expect(byKey["prepaid.expiring"]).toBeUndefined();
      expect(result.failures).toEqual([]);
    });

    test("an organization without usage credits (403) gives no metric and no failure", async () => {
      const { result, byKey } = await collectCredits(() =>
        json({ type: "error", error: { type: "permission_error" } }, 403),
      );
      expect(byKey["prepaid.balance"]).toBeUndefined();
      expect(result.failures).toEqual([]);
    });

    test("an outage keeps the usage metrics and marks only the balance unavailable", async () => {
      const { result, byKey } = await collectCredits(() => new Response("down", { status: 503 }));
      expect(byKey["seven_day"]).toMatchObject({ availability: "available" });
      expect(byKey["prepaid.balance"]).toMatchObject({
        valueText: null,
        availability: "temporarily_unavailable",
      });
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.class).toBe("transient");
    });

    test("a changed shape is unknown, never zero", async () => {
      const { result, byKey } = await collectCredits(() => json({ balance: "lots" }));
      expect(byKey["prepaid.balance"]).toMatchObject({ valueText: null, availability: "unknown" });
      expect(result.failures[0]?.category).toBe("invalid_response");
    });

    test("no organization in the identity means no balance request", async () => {
      const { byKey, calls } = await collectCredits(() => json({ amount: 1, currency: "USD" }), {
        ...identity,
        workspaceId: null,
      });
      expect(byKey["prepaid.balance"]).toBeUndefined();
      expect(calls.some((call) => call.url.includes("prepaid"))).toBe(false);
    });
  });

  describe("banked reset grants", () => {
    const observed = Date.parse("2026-10-02T12:00:00Z");
    async function collectGrants(cedar: unknown) {
      const http = fakeFetch({
        [usageUrl]: () => json({ seven_day: { utilization: 1 }, cedar_ember: cedar }),
      });
      const connector = createClaudeConnector({
        runner: new FakeRunner(),
        fetch: http.fetch,
        now: () => observed,
      });
      const result = await connector.collect(
        credentialFromCredentialsFile(credentialsFile),
        identity,
      );
      return { result, http };
    }

    test("an eligible usable grant counts and is listed", async () => {
      const { result } = await collectGrants({ eligible: true, grants: [grant({})] });
      const count = result.metrics.find((m) => m.providerMetricKey === "reset_grants.available");
      expect(count).toMatchObject({ valueText: "1", kind: "reset_inventory", unit: "resets" });
      expect(result.resetCredits).toEqual([
        {
          providerCreditId: "grant-0",
          eligible: true,
          usable: true,
          expiresAt: Date.parse("2026-10-20T00:00:00Z"),
          rawLabel: "Synthetic grant",
        },
      ]);
    });

    test("a paused, expired or not-yet-started grant is listed but not counted", async () => {
      const { result } = await collectGrants({
        eligible: true,
        grants: [
          grant({ paused: true }),
          grant({ ends_at: "2026-10-01T00:00:00Z" }),
          grant({ starts_at: "2026-10-03T00:00:00Z" }),
          grant({ resets_left: 0 }),
          grant({ resets_left: 2, label: null }),
        ],
      });
      const count = result.metrics.find((m) => m.providerMetricKey === "reset_grants.available");
      expect(count?.valueText).toBe("2");
      expect(result.resetCredits?.map((c) => c.usable)).toEqual([false, false, false, false, true]);
      expect(result.resetCredits?.[4]?.rawLabel).toBe("2 left");
    });

    test("eligible with no usable grant is a real zero", async () => {
      const { result } = await collectGrants({ eligible: true, grants: [grant({ paused: true })] });
      const count = result.metrics.find((m) => m.providerMetricKey === "reset_grants.available");
      expect(count).toMatchObject({ valueText: "0", availability: "available" });
    });

    test("a missing count is unknown, not zero, and the inventory metric says so", async () => {
      const { result } = await collectGrants({
        eligible: true,
        grants: [grant({}), grant({ resets_left: undefined, label: null })],
      });
      const count = result.metrics.find((m) => m.providerMetricKey === "reset_grants.available");
      expect(count).toMatchObject({ valueText: null, availability: "unknown" });
      expect(result.resetCredits?.map((c) => c.usable)).toEqual([true, false]);
      expect(result.resetCredits?.[1]?.rawLabel).toBe("count unknown");
    });

    test("a missing count on a paused grant does not blur the total", async () => {
      const { result } = await collectGrants({
        eligible: true,
        grants: [grant({}), grant({ resets_left: undefined, paused: true })],
      });
      const count = result.metrics.find((m) => m.providerMetricKey === "reset_grants.available");
      expect(count).toMatchObject({ valueText: "1", availability: "available" });
    });

    test("ineligible surface emits no count and no rows", async () => {
      const { result } = await collectGrants({
        eligible: false,
        ineligible_reason: "surface",
        grants: [],
      });
      expect(result.metrics.some((m) => m.providerMetricKey === "reset_grants.available")).toBe(
        false,
      );
      expect(result.resetCredits).toEqual([]);
    });

    test("the usage request sends the Claude Code user agent", async () => {
      const { http } = await collectGrants({ eligible: false, grants: [] });
      const headers = z.record(z.string(), z.string()).parse(http.calls[0]?.init?.headers);
      expect(headers["user-agent"]).toBe(claudeCodeUserAgent);
      expect(claudeCodeUserAgent).toStartWith("claude-cli/");
    });
  });

  test("a scoped limit with percent null is unknown, never the string null", async () => {
    const connector = createClaudeConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({
        [usageUrl]: () =>
          json({
            limits: [
              {
                kind: "weekly_scoped",
                percent: null,
                resets_at: null,
                scope: { model: { display_name: "Fable" } },
              },
            ],
          }),
      }).fetch,
    });
    const result = await connector.collect(
      credentialFromCredentialsFile(credentialsFile),
      identity,
    );
    const metric = result.metrics.find((m) => m.providerMetricKey === "limits.Fable");
    expect(metric).toMatchObject({ valueText: null, availability: "unknown" });
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

  test("a rate-limited refresh honours Retry-After and never echoes the provider body", async () => {
    const limited = createClaudeConnector({
      runner: new FakeRunner(),
      fetch: () =>
        Promise.resolve(
          new Response("MARKER-synthetic", { status: 429, headers: { "retry-after": "300" } }),
        ),
    });
    const result = await limited.refresh(credentialFromCredentialsFile(credentialsFile));
    expect(result).toMatchObject({
      status: "transient",
      error: { category: "rate_limited", retryAfterMs: 300_000 },
    });
    expect(JSON.stringify(result)).not.toContain("MARKER");
  });
});
