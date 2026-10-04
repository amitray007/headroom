import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { grokBotUsageUrl, pollUrl, refreshUrl, usageUrl } from "./endpoints.ts";
import grokBotUsage from "./fixtures/grok-bot-usage.json";
import periodUsageLiveShape from "./fixtures/period-usage-live-shape.json";
import periodUsage from "./fixtures/period-usage.json";
import { buildLoginUrl, createCursorConnector, grokBotMetric, pkce } from "./index.ts";

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
const jwt = (payload: Record<string, unknown>) => `${b64({ alg: "none" })}.${b64(payload)}.sig`;
const access = jwt({ sub: "user_01HSYNTHETIC", exp: 1_700_003_600 });

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

const credential = {
  secret: { accessToken: access, refreshToken: "refresh-synthetic" },
  expiresAt: null,
};
const identity = {
  providerAccountId: "user_01HSYNTHETIC",
  workspaceId: null,
  label: "x",
  assurance: "strong" as const,
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("Cursor connector", () => {
  test("login URL carries the S256 challenge, uuid and cli redirect target", () => {
    const url = new URL(buildLoginUrl(pkce("verifier"), "uuid-1"));
    expect(url.origin + url.pathname).toBe("https://cursor.com/loginDeepControl");
    expect(url.searchParams.get("challenge")).toBe(pkce("verifier"));
    expect(url.searchParams.get("mode")).toBe("login");
    expect(url.searchParams.get("redirectTarget")).toBe("cli");
    expect(pkce("verifier")).not.toContain("=");
  });

  test("approval polling: 404 waits, then tokens arrive with the verifier sent back", async () => {
    let polls = 0;
    const http = fakeFetch({
      [pollUrl]: () => {
        polls += 1;
        return polls === 1
          ? new Response("", { status: 404 })
          : json({ accessToken: access, refreshToken: "refresh-1" });
      },
    });
    const connector = createCursorConnector({
      fetch: http.fetch,
      randomness: () => ({ verifier: "ver", uuid: "uuid-1" }),
    });
    const begun = await connector.beginConnect({
      attemptId: "a",
      method: "approval_poll",
      expiresAt: 1,
    });
    expect(begun).toMatchObject({
      status: "next_step",
      nextStep: { kind: "open_url" },
      privateState: { verifier: "ver", uuid: "uuid-1" },
    });
    expect(await connector.pollConnect({ verifier: "ver", uuid: "uuid-1" })).toMatchObject({
      status: "waiting",
    });
    const done = await connector.pollConnect({ verifier: "ver", uuid: "uuid-1" });
    expect(done).toMatchObject({
      status: "credentials",
      credential: { expiresAt: 1_700_003_600_000, secret: { refreshToken: "refresh-1" } },
    });
    expect(http.calls[0]?.url).toBe(`${pollUrl}?uuid=uuid-1&verifier=ver`);
  });

  test("identity is the token subject; usage uses the Connect RPC with a Bearer token", async () => {
    const http = fakeFetch({ [usageUrl]: () => json(periodUsage) });
    const connector = createCursorConnector({ fetch: http.fetch, now: () => 1_700_000_000_000 });
    expect(await connector.identity(credential)).toMatchObject({
      providerAccountId: "user_01HSYNTHETIC",
    });
    const result = await connector.collect(credential, identity);
    const headers = z.record(z.string(), z.string()).parse(http.calls[0]?.init?.headers);
    expect(headers["connect-protocol-version"]).toBe("1");
    expect(headers["authorization"]).toBe(`Bearer ${access}`);
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["included.total_percent"]).toMatchObject({
      valueText: "62.5",
      resetsAt: Date.parse("2026-10-15T00:00:00Z"),
    });
    expect(byKey["included.auto_percent"]).toMatchObject({ valueText: "40" });
    expect(byKey["included.api_percent"]).toMatchObject({ valueText: "22.5" });
    expect(byKey["included.limit"]).toMatchObject({
      valueText: "20.00",
      unit: "USD",
      kind: "spending_cap",
    });
    expect(byKey["on_demand.used"]).toMatchObject({
      valueText: "3.00",
      kind: "spend",
      scope: "on_demand:user",
    });
    expect(byKey["on_demand.limit"]).toMatchObject({ valueText: "50.00" });
  });

  test("the live dashboard shape of 2026-10-01 parses: epoch-string cycle bounds, rounded percentages", async () => {
    const connector = createCursorConnector({
      fetch: fakeFetch({ [usageUrl]: () => json(periodUsageLiveShape) }).fetch,
    });
    const result = await connector.collect(credential, identity);
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["included.api_percent"]).toMatchObject({
      valueText: "6.48",
      windowStart: 1790870400000,
      windowEnd: 1793462400000,
      resetsAt: 1793462400000,
    });
    expect(byKey["included.total_percent"]).toMatchObject({ valueText: "17" });
    expect(byKey["included.limit"]).toMatchObject({ valueText: "20.00" });
    expect(byKey["on_demand.used"]).toMatchObject({ valueText: "0.00", scope: "on_demand:user" });
    expect(result.metrics.every((m) => m.availability === "available")).toBe(true);
  });

  test("missing percentages are unknown; 401 is definitive", async () => {
    const connector = createCursorConnector({
      fetch: fakeFetch({ [usageUrl]: () => json({ enabled: true }) }).fetch,
    });
    const result = await connector.collect(credential, identity);
    expect(
      result.metrics.find((m) => m.providerMetricKey === "included.total_percent"),
    ).toMatchObject({ valueText: null, availability: "unknown" });
    const unauthorized = createCursorConnector({
      fetch: fakeFetch({ [usageUrl]: () => json({}, 401) }).fetch,
    });
    expect(await rejection(unauthorized.collect(credential, identity))).toMatchObject({
      category: "authentication_required",
    });
  });

  test("Grok Bot usage is a weekly meter beside the Cursor usage", async () => {
    const http = fakeFetch({
      [usageUrl]: () => json(periodUsage),
      [grokBotUsageUrl]: () => json(grokBotUsage),
    });
    const connector = createCursorConnector({ fetch: http.fetch });
    const result = await connector.collect(credential, identity);
    expect(http.calls.map((call) => call.url)).toEqual([usageUrl, grokBotUsageUrl]);
    const headers = z.record(z.string(), z.string()).parse(http.calls[1]?.init?.headers);
    expect(headers["authorization"]).toBe(`Bearer ${access}`);
    expect(result.failures).toEqual([]);
    expect(result.metrics.find((m) => m.providerMetricKey === "grok_bot.used_percent")).toEqual({
      providerMetricKey: "grok_bot.used_percent",
      kind: "quota_percentage",
      scope: "window:604800s",
      valueText: "41.67",
      unit: "percent",
      windowStart: Date.parse("2026-09-28T00:00:00Z"),
      windowEnd: Date.parse("2026-10-05T00:00:00Z"),
      resetsAt: Date.parse("2026-10-05T00:00:00Z"),
      availability: "available",
      interface: "private",
    });
  });

  test("no Grok Bot meter for an account without its own allowance, and no failure either", async () => {
    expect(grokBotMetric({ ...grokBotUsage, usesPooledEnterpriseAllowance: true })).toBeNull();
    expect(grokBotMetric({ ...grokBotUsage, hasNonZeroIncludedLimit: false })).toBeNull();
    expect(grokBotMetric({ ...grokBotUsage, includedLimitZero: true })).toBeNull();
    expect(grokBotMetric({ hasNonZeroIncludedLimit: true })).toBeNull();
    const results = await Promise.all(
      [403, 404].map((status) =>
        createCursorConnector({
          fetch: fakeFetch({
            [usageUrl]: () => json(periodUsage),
            [grokBotUsageUrl]: () => json({}, status),
          }).fetch,
        }).collect(credential, identity),
      ),
    );
    for (const result of results) {
      expect(result.failures).toEqual([]);
      expect(result.metrics.some((m) => m.providerMetricKey === "grok_bot.used_percent")).toBe(
        false,
      );
    }
  });

  test("a Grok Bot failure is recorded but keeps the Cursor usage", async () => {
    const connector = createCursorConnector({
      fetch: fakeFetch({
        [usageUrl]: () => json(periodUsage),
        [grokBotUsageUrl]: () => json({}, 503),
      }).fetch,
    });
    const result = await connector.collect(credential, identity);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ category: "provider_unavailable" });
    expect(result.metrics.some((m) => m.providerMetricKey === "included.total_percent")).toBe(true);
  });

  test("a Grok Bot period without a start falls back to a week ending at the reset", () => {
    expect(
      grokBotMetric({ usagePercent: 120, nextResetTimestampUtc: "2026-10-05T00:00:00Z" }),
    ).toMatchObject({
      scope: "window:604800s",
      valueText: "100",
      windowStart: Date.parse("2026-09-28T00:00:00Z"),
    });
  });

  test("refresh exchanges the refresh token as a Bearer; rejections are definitive", async () => {
    const http = fakeFetch({
      [refreshUrl]: () =>
        json({ accessToken: jwt({ sub: "user_01HSYNTHETIC", exp: 1_700_007_200 }) }),
    });
    const connector = createCursorConnector({ fetch: http.fetch });
    expect(await connector.refresh(credential)).toMatchObject({
      status: "refreshed",
      credential: { expiresAt: 1_700_007_200_000, secret: { refreshToken: "refresh-synthetic" } },
    });
    const headers = z.record(z.string(), z.string()).parse(http.calls[0]?.init?.headers);
    expect(headers["authorization"]).toBe("Bearer refresh-synthetic");
    const rejected = createCursorConnector({
      fetch: fakeFetch({ [refreshUrl]: () => json({ error: "Invalid User API Key" }, 401) }).fetch,
    });
    expect(await rejected.refresh(credential)).toMatchObject({ status: "rejected" });
  });

  test("a rate-limited refresh honours Retry-After", async () => {
    const connector = createCursorConnector({
      fetch: fakeFetch({
        [refreshUrl]: () => new Response("", { status: 429, headers: { "retry-after": "600" } }),
      }).fetch,
    });
    expect(await connector.refresh(credential)).toMatchObject({
      status: "transient",
      error: { category: "rate_limited", retryAfterMs: 600_000 },
    });
  });
});
