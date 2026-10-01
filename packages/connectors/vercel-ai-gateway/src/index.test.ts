import { describe, expect, test } from "bun:test";

import { createVercelConnector, type FetchLike } from "./index.ts";

function fakeFetch(handler: (url: string) => Response) {
  const calls: string[] = [];
  const call = (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return Promise.resolve(handler(url));
  };
  // Bun's `typeof fetch` also carries `preconnect`; the SDK never calls it.
  const impl: FetchLike = Object.assign(call, { preconnect: (): void => undefined });
  return { fetch: impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const credential = { secret: { apiKey: "vck_synthetic" }, expiresAt: null };
const identity = {
  providerAccountId: "gateway-key:x",
  workspaceId: null,
  label: "x",
  assurance: "weak" as const,
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("Vercel AI Gateway connector", () => {
  test("connect is a single api_key step that becomes a non-refreshable credential", async () => {
    const connector = createVercelConnector({ fetch: fakeFetch(() => json({})).fetch });
    const begun = await connector.beginConnect({ attemptId: "a", method: "api_key", expiresAt: 1 });
    expect(begun).toMatchObject({ status: "next_step", nextStep: { kind: "api_key" } });
    const credentials = await connector.submitInput(
      {},
      { kind: "api_key", values: { apiKey: " vck_x " } },
    );
    expect(credentials).toEqual({
      status: "credentials",
      credential: { secret: { apiKey: "vck_x" }, expiresAt: null },
    });
    expect(await connector.refresh(credential)).toEqual({ status: "not_refreshable" });
    expect(await connector.disconnect(credential)).toBe("local_only");
  });

  test("identity validates the key against credits and fingerprints it", async () => {
    const http = fakeFetch((url) =>
      url.includes("/credits") ? json({ balance: "12.50", total_used: "7.25" }) : json({}, 404),
    );
    const connector = createVercelConnector({ fetch: http.fetch });
    const id = await connector.identity(credential);
    expect(id.providerAccountId.startsWith("gateway-key:")).toBe(true);
    expect(id.providerAccountId).not.toContain("vck_synthetic");
    expect(http.calls[0]).toContain("/v1/credits");
  });

  test("collect records balance, total used and the spend report total", async () => {
    const http = fakeFetch((url) => {
      if (url.includes("/credits")) return json({ balance: "12.50", total_used: "7.25" });
      if (url.includes("/v1/report")) {
        return json({
          results: [
            { day: "2026-09-01", total_cost: 1.5 },
            { day: "2026-09-02", total_cost: 0.25 },
          ],
        });
      }
      return json({}, 404);
    });
    const connector = createVercelConnector({
      fetch: http.fetch,
      now: () => Date.parse("2026-10-01T00:00:00Z"),
      spendDays: 30,
    });
    const result = await connector.collect(credential, identity);
    expect(result.failures).toEqual([]);
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["credits.balance"]).toMatchObject({
      valueText: "12.50",
      unit: "gateway_credits",
      interface: "official",
    });
    expect(byKey["credits.total_used"]).toMatchObject({ valueText: "7.25" });
    expect(byKey["spend.30d"]).toMatchObject({ valueText: "1.750000", unit: "USD", kind: "spend" });
    const spendCall = http.calls.find((c) => c.includes("/v1/report"));
    expect(spendCall).toContain("start_date=2026-09-01");
    expect(spendCall).toContain("end_date=2026-10-01");
  });

  test("a forbidden spend report is a capability gap, not a reconnect; a bad key is definitive", async () => {
    const forbidden = createVercelConnector({
      fetch: fakeFetch((url) =>
        url.includes("/credits")
          ? json({ balance: "1", total_used: "0" })
          : json({ error: { message: "plan" } }, 403),
      ).fetch,
    });
    const result = await forbidden.collect(credential, identity);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.class).toBe("capability");
    expect(result.metrics.find((m) => m.providerMetricKey === "spend.30d")).toMatchObject({
      availability: "not_authorized",
    });

    const badKey = createVercelConnector({
      fetch: fakeFetch(() => json({ error: { message: "nope" } }, 401)).fetch,
    });
    const error = await rejection(badKey.collect(credential, identity));
    expect(badKey.classify(error)).toMatchObject({
      category: "authentication_required",
      class: "definitive",
    });
  });

  test("drift in the credits response is invalid_response", async () => {
    const connector = createVercelConnector({
      fetch: fakeFetch(() => json({ balance: 12 })).fetch,
    });
    const error = await rejection(connector.collect(credential, identity));
    expect(connector.classify(error)).toMatchObject({ category: "invalid_response" });
  });
});
