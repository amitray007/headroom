import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { accessTokenUrl, deviceCodeUrl, usageUrl, userUrl } from "./endpoints.ts";
import orgSeat from "./fixtures/usage-org-seat.json";
import paid from "./fixtures/usage-paid.json";
import { createCopilotConnector, credentialFromAppsFile } from "./index.ts";

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (url: string, init?: RequestInit) => {
    calls.push(init ? { url, init } : { url });
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    return Promise.resolve(match ? routes[match]!() : new Response("nf", { status: 404 }));
  };
  return { fetch: impl, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const credential = { secret: { token: "gho_synthetic" }, expiresAt: null };
const identity = {
  providerAccountId: "1",
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

describe("Copilot connector", () => {
  test("device flow: begin requests a code with read:user, poll handles pending, slow_down and success", async () => {
    let polls = 0;
    const http = fakeFetch({
      [deviceCodeUrl]: () =>
        json({
          device_code: "dev",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        }),
      [accessTokenUrl]: () => {
        polls += 1;
        if (polls === 1) return json({ error: "authorization_pending" });
        if (polls === 2) return json({ error: "slow_down" });
        return json({ access_token: "gho_new", token_type: "bearer", scope: "read:user" });
      },
    });
    const connector = createCopilotConnector({ fetch: http.fetch, now: () => 1_700_000_000_000 });
    const begun = await connector.beginConnect({
      attemptId: "a",
      method: "device_code",
      expiresAt: 1_700_001_000_000,
    });
    expect(begun).toMatchObject({
      status: "next_step",
      nextStep: { kind: "device_code", userCode: "ABCD-1234", expiresAt: 1_700_000_900_000 },
    });
    const requested = z
      .record(z.string(), z.string())
      .parse(JSON.parse(z.string().parse(http.calls[0]?.init?.body)));
    expect(requested).toEqual({ client_id: "178c6fc778ccc68e1d6a", scope: "read:user" });
    if (begun.status !== "next_step") throw new Error("unreachable");
    const pending = await connector.pollConnect(begun.privateState);
    expect(pending).toMatchObject({ status: "waiting", pollAfterMs: 5000 });
    const slowed = await connector.pollConnect(begun.privateState);
    expect(slowed).toMatchObject({ status: "waiting", pollAfterMs: 10_000 });
    expect(await connector.pollConnect(begun.privateState)).toEqual({
      status: "credentials",
      credential: { secret: { token: "gho_new" }, expiresAt: null },
    });
  });

  test("denied and expired device codes end the attempt; apps.json import works", async () => {
    const denied = createCopilotConnector({
      fetch: fakeFetch({ [accessTokenUrl]: () => json({ error: "access_denied" }) }).fetch,
    });
    expect(await denied.pollConnect({ deviceCode: "d", intervalMs: 5000 })).toMatchObject({
      status: "error",
      error: { category: "approval_denied" },
    });
    const expired = createCopilotConnector({
      fetch: fakeFetch({ [accessTokenUrl]: () => json({ error: "expired_token" }) }).fetch,
    });
    expect(await expired.pollConnect({ deviceCode: "d", intervalMs: 5000 })).toMatchObject({
      status: "error",
      error: { category: "approval_expired" },
    });
    expect(
      credentialFromAppsFile(
        JSON.stringify({ "github.com:Iv1.x": { user: "amit", oauth_token: "gho_file" } }),
      ),
    ).toEqual({
      secret: { token: "gho_file" },
      expiresAt: null,
    });
    expect(() => credentialFromAppsFile("{}")).toThrow(/apps\.json/);
  });

  test("identity comes from /user; usage headers use the token scheme and editor identity", async () => {
    const http = fakeFetch({
      [userUrl]: () => json({ id: 42, login: "amit" }),
      [usageUrl]: () => json(paid),
    });
    const connector = createCopilotConnector({ fetch: http.fetch });
    expect(await connector.identity(credential)).toEqual({
      providerAccountId: "42",
      workspaceId: null,
      label: "amit (Copilot)",
      assurance: "strong",
    });
    await connector.collect(credential, identity);
    const headers = z.record(z.string(), z.string()).parse(http.calls[1]?.init?.headers);
    expect(headers["authorization"]).toBe("token gho_synthetic");
    expect(headers["x-github-api-version"]).toBe("2025-04-01");
  });

  test("paid plan: credits percent used, extra usage count, unlimited chat and completions", async () => {
    const connector = createCopilotConnector({
      fetch: fakeFetch({ [usageUrl]: () => json(paid) }).fetch,
    });
    const result = await connector.collect(credential, identity);
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["credits.used_percent"]).toMatchObject({
      valueText: "30",
      availability: "available",
      resetsAt: Date.parse("2026-11-01"),
    });
    expect(byKey["extra_usage.count"]).toMatchObject({ valueText: "12", kind: "absolute_quota" });
    expect(byKey["chat.used"]).toMatchObject({
      valueText: null,
      unlimited: true,
      availability: "available",
    });
    expect(byKey["completions.used"]).toMatchObject({ unlimited: true });
    expect(byKey["credits.used_count"]).toBeUndefined();
  });

  test("org-managed seat: no percent pool, personal credits count, real chat and completions counts", async () => {
    const connector = createCopilotConnector({
      fetch: fakeFetch({ [usageUrl]: () => json(orgSeat) }).fetch,
    });
    const result = await connector.collect(credential, identity);
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["credits.used_percent"]).toMatchObject({
      valueText: null,
      availability: "unsupported",
    });
    expect(byKey["credits.used_count"]).toMatchObject({ valueText: "42" });
    expect(byKey["extra_usage.count"]).toMatchObject({ availability: "unsupported" });
    expect(byKey["chat.used"]).toMatchObject({ valueText: "15", unlimited: false });
    expect(byKey["completions.used"]).toMatchObject({ valueText: "500" });
  });

  test("401 is definitive, secondary rate limit 403 is transient, token is not refreshable", async () => {
    const unauthorized = createCopilotConnector({
      fetch: fakeFetch({ [usageUrl]: () => json({}, 401) }).fetch,
    });
    expect(await rejection(unauthorized.collect(credential, identity))).toMatchObject({
      category: "authentication_required",
    });
    const limited = createCopilotConnector({
      fetch: fakeFetch({ [usageUrl]: () => json({}, 403, { "retry-after": "30" }) }).fetch,
    });
    expect(await rejection(limited.collect(credential, identity))).toMatchObject({
      category: "rate_limited",
      retryAfterMs: 30_000,
    });
    expect(await unauthorized.refresh(credential)).toEqual({ status: "not_refreshable" });
    expect(await unauthorized.disconnect(credential)).toBe("local_only");
  });
});
