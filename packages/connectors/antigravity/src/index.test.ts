import { describe, expect, test } from "bun:test";

import { z } from "zod";

import {
  cloudCodeHosts,
  fetchAvailableModelsPath,
  loadCodeAssistBody,
  loadCodeAssistPath,
  quotaSummaryPath,
  tokenUrl,
  userInfoUrl,
} from "./endpoints.ts";
import modelsFixture from "./fixtures/fetch-available-models.json";
import quotaFixture from "./fixtures/quota-summary.json";
import { buildAuthorizationUrl, codeFromInput, createAntigravityConnector } from "./index.ts";

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
  secret: { accessToken: "ya29.synthetic", refreshToken: "1//refresh", email: null, subject: null },
  expiresAt: null,
};
const identity = {
  providerAccountId: "1234567890",
  workspaceId: null,
  label: "x",
  assurance: "strong" as const,
};
const daily = cloudCodeHosts[0]!;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

const limited = () => new Response("", { status: 429, headers: { "retry-after": "900" } });

describe("Antigravity connector", () => {
  test("authorization URL carries the client, loopback redirect, scopes and state; pasted input is parsed", () => {
    const url = new URL(buildAuthorizationUrl("state-1"));
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:51121/oauth-callback");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("scope")).toContain("cloud-platform");
    expect(
      codeFromInput({
        kind: "redirect",
        value: "http://localhost:51121/oauth-callback?code=4/abc&state=state-1",
      }),
    ).toEqual({
      code: "4/abc",
      state: "state-1",
    });
    expect(codeFromInput({ kind: "code", value: " 4/abc " })).toEqual({
      code: "4/abc",
      state: null,
    });
    expect(codeFromInput({ kind: "file", contents: "x" })).toBeNull();
  });

  test("connect: pasted redirect is exchanged with the client secret; a foreign state is refused", async () => {
    const http = fakeFetch({
      [tokenUrl]: () => json({ access_token: "ya29.new", refresh_token: "1//r", expires_in: 3599 }),
    });
    const connector = createAntigravityConnector({
      fetch: http.fetch,
      now: () => 1_700_000_000_000,
      randomState: () => "state-1",
    });
    const begun = await connector.beginConnect({
      attemptId: "a",
      method: "paste_redirect",
      expiresAt: 1,
    });
    expect(begun).toMatchObject({
      status: "next_step",
      nextStep: { kind: "paste_redirect" },
      privateState: { state: "state-1" },
    });
    const wrong = await connector.submitInput(
      { state: "state-1" },
      { kind: "redirect", value: "http://localhost:51121/oauth-callback?code=x&state=other" },
    );
    expect(wrong).toMatchObject({ status: "error", error: { category: "approval_denied" } });
    const done = await connector.submitInput(
      { state: "state-1" },
      { kind: "redirect", value: "http://localhost:51121/oauth-callback?code=4/abc&state=state-1" },
    );
    expect(done).toMatchObject({
      status: "credentials",
      credential: { expiresAt: 1_700_003_599_000, secret: { refreshToken: "1//r" } },
    });
    const body = z.instanceof(URLSearchParams).parse(http.calls[0]?.init?.body).toString();
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("client_secret=");
    expect(body).toContain("code=4%2Fabc");
  });

  test("identity uses Google userinfo and the plan from loadCodeAssist", async () => {
    const http = fakeFetch({
      [userInfoUrl]: () => json({ id: "1234567890", email: "owner@example.com" }),
      [`${daily}${loadCodeAssistPath}`]: () =>
        json({
          cloudaicompanionProject: "proj",
          currentTier: { name: "free-tier" },
          paidTier: { name: "pro-tier" },
        }),
    });
    const connector = createAntigravityConnector({ fetch: http.fetch });
    expect(await connector.identity(credential)).toEqual({
      providerAccountId: "1234567890",
      workspaceId: null,
      label: "owner@example.com (pro-tier)",
      assurance: "strong",
    });
  });

  test("collect converts remaining fractions to used percent, keeps unknown buckets, omits unreported ones", async () => {
    const http = fakeFetch({
      [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
      [`${daily}${quotaSummaryPath}`]: () => json(quotaFixture),
    });
    const connector = createAntigravityConnector({
      fetch: http.fetch,
      now: () => 1_700_000_000_000,
    });
    const result = await connector.collect(credential, identity);
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["quota.gemini-5h"]).toMatchObject({
      valueText: "25.00",
      scope: "window:18000s",
      resetsAt: Date.parse("2026-10-01T18:00:00Z"),
    });
    expect(byKey["quota.gemini-weekly"]).toMatchObject({ valueText: "60.00" });
    expect(byKey["quota.3p-5h"]).toMatchObject({ valueText: "0.00" });
    expect(byKey["quota.unknown-bucket"]).toMatchObject({ valueText: "50.00", scope: "window" });
    expect(Object.keys(byKey)).not.toContain("quota.3p-weekly");
    expect(result.metrics.every((m) => m.availability === "available")).toBe(true);
    const headers = z.record(z.string(), z.string()).parse(http.calls[0]?.init?.headers);
    expect(headers["user-agent"]).toBe("antigravity");
    expect(http.calls[0]?.init?.method).toBe("POST");
    // loadCodeAssist carries the client metadata; the quota summary carries the project it returned.
    expect(http.calls[0]?.init?.body).toBe(JSON.stringify(loadCodeAssistBody));
    expect(http.calls[1]?.url).toBe(`${daily}${quotaSummaryPath}`);
    expect(http.calls[1]?.init?.body).toBe(JSON.stringify({ project: "proj" }));
  });

  test("collect falls back to fetchAvailableModels when gemini-5h is missing from quotaSummary (picks worst model)", async () => {
    const http = fakeFetch({
      [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
      [`${daily}${quotaSummaryPath}`]: () =>
        json({
          groups: [
            {
              displayName: "Claude and GPT models",
              buckets: [
                {
                  bucketId: "3p-weekly",
                  remainingFraction: 1,
                  resetTime: "2026-11-08T10:00:00Z",
                },
                {
                  bucketId: "3p-5h",
                  remainingFraction: 0.95,
                  resetTime: "2026-11-01T15:00:00Z",
                },
              ],
            },
          ],
        }),
      [`${daily}${fetchAvailableModelsPath}`]: () => json(modelsFixture),
    });
    const connector = createAntigravityConnector({
      fetch: http.fetch,
      now: () => 1_700_000_000_000,
    });
    const result = await connector.collect(credential, identity);
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    // Pro (0.15 remaining) is chosen over Flash (0.85 remaining) as the worst fraction
    expect(byKey["quota.gemini-5h"]).toMatchObject({
      valueText: "85.00",
      scope: "window:18000s",
      resetsAt: Date.parse("2026-11-01T17:00:00Z"),
    });
    expect(byKey["quota.3p-5h"]).toMatchObject({ valueText: "5.00" });
    expect(byKey["quota.3p-weekly"]).toMatchObject({ valueText: "0.00" });
    expect(result.failures).toEqual([]);
    expect(http.calls[2]?.url).toBe(`${daily}${fetchAvailableModelsPath}`);
    expect(http.calls[2]?.init?.body).toBe(JSON.stringify({ project: "proj" }));
  });

  test("collect picks worst Gemini model regardless of order and breaks ties by model name", async () => {
    // Reverse order: lower remaining fraction listed first
    const reverseHttp = fakeFetch({
      [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
      [`${daily}${quotaSummaryPath}`]: () =>
        json({ groups: [{ buckets: [{ bucketId: "3p-5h", remainingFraction: 1 }] }] }),
      [`${daily}${fetchAvailableModelsPath}`]: () =>
        json({
          models: {
            "gemini-a-worst": {
              quotaInfo: { remainingFraction: 0.1, resetTime: "2026-11-01T12:00:00Z" },
            },
            "gemini-b-better": {
              quotaInfo: { remainingFraction: 0.9, resetTime: "2026-11-01T13:00:00Z" },
            },
          },
        }),
    });
    const connector1 = createAntigravityConnector({ fetch: reverseHttp.fetch });
    const res1 = await connector1.collect(credential, identity);
    const metric1 = res1.metrics.find((m) => m.providerMetricKey === "quota.gemini-5h");
    expect(metric1).toMatchObject({
      valueText: "90.00",
      resetsAt: Date.parse("2026-11-01T12:00:00Z"),
    });

    // Tie: identical remainingFraction; breaks tie by alphabetic model key
    const tieHttp = fakeFetch({
      [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
      [`${daily}${quotaSummaryPath}`]: () =>
        json({ groups: [{ buckets: [{ bucketId: "3p-5h", remainingFraction: 1 }] }] }),
      [`${daily}${fetchAvailableModelsPath}`]: () =>
        json({
          models: {
            "gemini-z": {
              quotaInfo: { remainingFraction: 0.5, resetTime: "2026-11-01T20:00:00Z" },
            },
            "gemini-a": {
              quotaInfo: { remainingFraction: 0.5, resetTime: "2026-11-01T10:00:00Z" },
            },
          },
        }),
    });
    const connector2 = createAntigravityConnector({ fetch: tieHttp.fetch });
    const res2 = await connector2.collect(credential, identity);
    const metric2 = res2.metrics.find((m) => m.providerMetricKey === "quota.gemini-5h");
    expect(metric2).toMatchObject({
      valueText: "50.00",
      resetsAt: Date.parse("2026-11-01T10:00:00Z"),
    });
  });

  test("fetchAvailableModels failure paths report into failures and preserve summary metrics", async () => {
    const baseSummary = {
      groups: [{ buckets: [{ bucketId: "3p-5h", remainingFraction: 0.9 }] }],
    };

    // 401: authentication_required
    const authFail = createAntigravityConnector({
      fetch: fakeFetch({
        [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
        [`${daily}${quotaSummaryPath}`]: () => json(baseSummary),
        [`${daily}${fetchAvailableModelsPath}`]: () => json({}, 401),
      }).fetch,
    });
    const resAuth = await authFail.collect(credential, identity);
    expect(resAuth.metrics.some((m) => m.providerMetricKey === "quota.3p-5h")).toBe(true);
    expect(resAuth.failures).toHaveLength(1);
    expect(resAuth.failures[0]?.category).toBe("authentication_required");

    // 429: rate_limited with Retry-After
    const rateFail = createAntigravityConnector({
      fetch: fakeFetch({
        [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
        [`${daily}${quotaSummaryPath}`]: () => json(baseSummary),
        [`${daily}${fetchAvailableModelsPath}`]: limited,
      }).fetch,
    });
    const resRate = await rateFail.collect(credential, identity);
    expect(resRate.failures).toHaveLength(1);
    expect(resRate.failures[0]?.category).toBe("rate_limited");
    expect(resRate.failures[0]?.retryAfterMs).toBe(900_000);

    // 500 on all hosts: provider_unavailable
    const serverFail = createAntigravityConnector({
      fetch: fakeFetch({
        [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
        [`${daily}${quotaSummaryPath}`]: () => json(baseSummary),
        [`${daily}${fetchAvailableModelsPath}`]: () => json({}, 500),
        [`${cloudCodeHosts[1]}${fetchAvailableModelsPath}`]: () => json({}, 500),
      }).fetch,
    });
    const resServer = await serverFail.collect(credential, identity);
    expect(resServer.failures).toHaveLength(1);
    expect(resServer.failures[0]?.category).toBe("provider_unavailable");

    // Malformed JSON / invalid shape: invalid_response
    const malformedFail = createAntigravityConnector({
      fetch: fakeFetch({
        [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
        [`${daily}${quotaSummaryPath}`]: () => json(baseSummary),
        [`${daily}${fetchAvailableModelsPath}`]: () => json({ models: "not-an-object-of-models" }),
      }).fetch,
    });
    const resMalformed = await malformedFail.collect(credential, identity);
    expect(resMalformed.failures).toHaveLength(1);
    expect(resMalformed.failures[0]?.category).toBe("invalid_response");

    // Out-of-range remainingFraction (> 1 or < 0): invalid_response
    const outOfRangeFail = createAntigravityConnector({
      fetch: fakeFetch({
        [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
        [`${daily}${quotaSummaryPath}`]: () => json(baseSummary),
        [`${daily}${fetchAvailableModelsPath}`]: () =>
          json({ models: { "gemini-pro": { quotaInfo: { remainingFraction: 1.5 } } } }),
      }).fetch,
    });
    const resOutOfRange = await outOfRangeFail.collect(credential, identity);
    expect(resOutOfRange.failures).toHaveLength(1);
    expect(resOutOfRange.failures[0]?.category).toBe("invalid_response");
  });

  test("free-tier summary with only weekly buckets does not call fetchAvailableModels", async () => {
    const http = fakeFetch({
      [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
      [`${daily}${quotaSummaryPath}`]: () =>
        json({
          groups: [
            {
              buckets: [
                { bucketId: "gemini-weekly", remainingFraction: 0.8 },
                { bucketId: "3p-weekly", remainingFraction: 0.9 },
              ],
            },
          ],
        }),
    });
    const connector = createAntigravityConnector({ fetch: http.fetch });
    const result = await connector.collect(credential, identity);
    expect(result.failures).toEqual([]);
    expect(http.calls.map((c) => c.url)).toEqual([
      `${daily}${loadCodeAssistPath}`,
      `${daily}${quotaSummaryPath}`,
    ]);
  });

  test("a quota summary 403 is permission_denied, as is an account without a project", async () => {
    const forbidden = createAntigravityConnector({
      fetch: fakeFetch({
        [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: { id: "p2" } }),
        [`${daily}${quotaSummaryPath}`]: () => json({ error: { code: 403 } }, 403),
      }).fetch,
    });
    expect(await rejection(forbidden.collect(credential, identity))).toMatchObject({
      category: "permission_denied",
    });
    const projectless = createAntigravityConnector({
      fetch: fakeFetch({ [`${daily}${loadCodeAssistPath}`]: () => json({ currentTier: {} }) })
        .fetch,
    });
    expect(await rejection(projectless.collect(credential, identity))).toMatchObject({
      category: "permission_denied",
    });
  });

  test("falls back to the second host on a 5xx, and 401 is definitive", async () => {
    const first = fakeFetch({
      [`${daily}${loadCodeAssistPath}`]: () => json({ cloudaicompanionProject: "proj" }),
      [`${daily}${quotaSummaryPath}`]: () => json({}, 503),
      [`${cloudCodeHosts[1]}${quotaSummaryPath}`]: () => json(quotaFixture),
    });
    const connector = createAntigravityConnector({ fetch: first.fetch });
    expect((await connector.collect(credential, identity)).metrics.length).toBeGreaterThan(0);
    expect(first.calls.map((c) => c.url)).toEqual([
      `${daily}${loadCodeAssistPath}`,
      `${daily}${quotaSummaryPath}`,
      `${cloudCodeHosts[1]}${quotaSummaryPath}`,
    ]);
    const unauthorized = createAntigravityConnector({
      fetch: fakeFetch({ [daily]: () => json({}, 401) }).fetch,
    });
    expect(await rejection(unauthorized.collect(credential, identity))).toMatchObject({
      category: "authentication_required",
    });
  });

  test("refresh rotates with the client secret; invalid_grant is rejected; revoke is attempted on disconnect", async () => {
    const http = fakeFetch({
      [tokenUrl]: () => json({ access_token: "ya29.rotated", expires_in: 3600 }),
    });
    const connector = createAntigravityConnector({
      fetch: http.fetch,
      now: () => 1_700_000_000_000,
    });
    expect(await connector.refresh(credential)).toMatchObject({
      status: "refreshed",
      credential: {
        expiresAt: 1_700_003_600_000,
        secret: { accessToken: "ya29.rotated", refreshToken: "1//refresh" },
      },
    });
    const rejected = createAntigravityConnector({
      fetch: fakeFetch({ [tokenUrl]: () => json({ error: "invalid_grant" }, 400) }).fetch,
    });
    expect(await rejected.refresh(credential)).toMatchObject({ status: "rejected" });
    const revoking = createAntigravityConnector({
      fetch: fakeFetch({ "https://oauth2.googleapis.com/revoke": () => json({}) }).fetch,
    });
    expect(await revoking.disconnect(credential)).toBe("revoked");
  });

  test("rate-limited refresh and quota calls honour Retry-After", async () => {
    const connector = createAntigravityConnector({
      fetch: fakeFetch({ [tokenUrl]: limited, [daily]: limited }).fetch,
    });
    expect(await connector.refresh(credential)).toMatchObject({
      status: "transient",
      error: { category: "rate_limited", retryAfterMs: 900_000 },
    });
    expect(await rejection(connector.collect(credential, identity))).toMatchObject({
      category: "rate_limited",
      retryAfterMs: 900_000,
    });
  });
});
