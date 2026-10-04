import { afterEach, describe, expect, test } from "bun:test";

import { api, demoRefusal, isDemoId, isDemoRefusal, type OrderBody } from "../api.ts";
import { devicePrefs } from "./device-prefs.ts";
import { defaultSettings } from "./settings-store.ts";

const realFetch = globalThis.fetch;
interface Call {
  method: string | undefined;
  path: string;
  body: unknown;
}

function stub(body: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({
        method: init?.method,
        path: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return Promise.resolve(Response.json(body, { status }));
    },
    { preconnect: realFetch.preconnect },
  );
  return calls;
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (cause) {
    return cause instanceof Error ? cause.message : "";
  }
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const overviewBody = {
  connections: [
    {
      id: "c1",
      provider: "claude",
      scope: "individual",
      state: "ready",
      reconnectReason: null,
      interface: "private",
      authMethod: "cli_login",
      name: null,
      identity: "owner@example.com",
      plan: "max",
      createdAt: 1,
      lastSuccessAt: 2,
      stale: false,
      latestRun: { startedAt: 2, finishedAt: null, outcome: null, error: null, failureStreak: 0 },
      snapshot: {
        observedAt: 2,
        metrics: [
          {
            providerMetricKey: "seven_day",
            kind: "quota_percentage",
            scope: "window:604800s",
            valueText: "78",
            valueNum: 78,
            unit: "percent",
            windowStart: null,
            windowEnd: null,
            resetsAt: 9,
            availability: "available",
            interface: "private",
          },
        ],
        resetCredits: [],
      },
      actions: { enabled: false, supported: [] },
    },
  ],
  providerOrder: ["codex", "claude"],
  refreshIntervalMs: 900_000,
  staleAfterMs: 2_700_000,
};

describe("api client", () => {
  test("overview parses, including a run with no outcome yet", async () => {
    const calls = stub(overviewBody);
    const overview = await api.overview();
    expect(calls[0]).toEqual({ method: "GET", path: "/api/overview", body: undefined });
    expect(overview.refreshIntervalMs).toBe(900_000);
    expect(overview.providerOrder).toEqual(["codex", "claude"]);
    expect(overview.connections[0]?.latestRun?.outcome).toBeNull();
    expect(overview.connections[0]?.snapshot?.metrics[0]?.valueNum).toBe(78);
  });
  test("overview rejects a shape the server should not send", async () => {
    stub({ connections: [{ id: "c1" }], refreshIntervalMs: 1, staleAfterMs: 1 });
    expect(await failure(api.overview())).toContain("unexpected response");
  });
  test("saving the order sends PUT with the full order", async () => {
    const order: OrderBody = { providers: ["codex", "claude"], accounts: { codex: ["a", "b"] } };
    const calls = stub(order);
    expect(await api.saveOrder(order)).toEqual(order);
    expect(calls[0]).toEqual({ method: "PUT", path: "/api/order", body: order });
  });
  test("rename sends PATCH with the name", async () => {
    const calls = stub({ name: "Work" });
    expect(await api.rename("c1", "Work")).toEqual({ name: "Work" });
    expect(calls[0]).toEqual({
      method: "PATCH",
      path: "/api/connections/c1",
      body: { name: "Work" },
    });
    stub({ name: null });
    expect(await api.rename("c1", null)).toEqual({ name: null });
  });
  test("settings load and save the full document", async () => {
    const envelope = { settings: defaultSettings };
    const calls = stub(envelope);
    expect(await api.settings()).toEqual(envelope);
    expect(await api.saveSettings({ ...defaultSettings, clock: "12h" })).toEqual(envelope);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[1]).toEqual({
      method: "PUT",
      path: "/api/settings",
      body: { ...defaultSettings, clock: "12h" },
    });
  });
  test("a settings value outside the allowed set is refused", async () => {
    stub({
      settings: { ...defaultSettings, lowThresholdPercent: 25 },
    });
    expect(await failure(api.settings())).toContain("unexpected response");
  });
});

describe("delivery api", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  test("a 204 delete resolves", async () => {
    globalThis.fetch = Object.assign(() => Promise.resolve(new Response(null, { status: 204 })), {
      preconnect: realFetch.preconnect,
    });
    expect(await api.deleteChannel("c1")).toBeUndefined();
  });
  test("a failed call keeps the error word", async () => {
    stub({ error: "telegram_token_rejected" }, 400);
    const cause = await api
      .createChannel({ type: "webhook", url: "https://x.test", includeIdentity: false })
      .catch((e: unknown) => e);
    expect(cause).toMatchObject({ status: 400, code: "telegram_token_rejected" });
  });
});

describe("demo mode guard", () => {
  afterEach(() => {
    devicePrefs().setDemo(false);
  });
  test("account changes are refused without a request", async () => {
    devicePrefs().setDemo(true);
    const calls = stub({});
    const refused = [
      api.rename("demo-1", "Work"),
      api.pause("demo-1", true),
      api.refresh("demo-1"),
      api.disconnect("demo-1"),
      api.consumeResetCredit("demo-1", "credit"),
      api.reconnect("demo-1", "cli_login"),
      api.beginAttempt("claude", "cli_login"),
      api.connection("demo-1"),
      api.setCost("demo-1", { kind: "free" }),
      api.clearCost("demo-1"),
      api.addTopUp({
        connectionId: "demo-1",
        date: "2026-10-01",
        kind: "free",
        price: null,
        credits: null,
        note: null,
        expiresOn: null,
        expiryAlertDays: null,
      }),
      api.updateTopUp("t1", {
        date: "2026-10-01",
        kind: "free",
        price: null,
        credits: null,
        note: null,
        expiresOn: null,
        expiryAlertDays: null,
      }),
      api.removeTopUp("t1"),
      api.setAutoReset("demo-1", {
        enabled: true,
        window: "weekly",
        thresholdPercent: 100,
        minHoursLeft: 24,
      }),
      api.clearAutoReset("demo-1"),
      api.setBudget("demo-1", "on_demand.used", 50),
      api.clearBudget("demo-1", "on_demand.used"),
    ];
    const causes = await Promise.all(refused.map((call) => call.catch((error: unknown) => error)));
    expect(causes).toHaveLength(17);
    for (const cause of causes) {
      expect(cause).toMatchObject({ status: 409, code: "demo_mode", message: demoRefusal });
      expect(isDemoRefusal(cause)).toBe(true);
    }
    expect(demoRefusal).toBe("Turn off Demo Mode to change accounts.");
    expect(calls).toEqual([]);
  });
  test("wallet calls reach the server with Demo Mode off", async () => {
    const book = { costs: { c1: { kind: "free" as const } }, topUps: [] };
    const calls = stub(book);
    expect(await api.wallet()).toEqual(book);
    await api.setCost("c1", { kind: "included", includedWith: "X Premium" });
    await api.clearCost("c1");
    await api.removeTopUp("t1");
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /api/wallet",
      "PUT /api/wallet/costs/c1",
      "DELETE /api/wallet/costs/c1",
      "DELETE /api/wallet/top-ups/t1",
    ]);
    expect(calls[1]?.body).toEqual({ kind: "included", includedWith: "X Premium" });
  });
  test("top-up updates, auto-reset rules and budgets use their own routes and bodies", async () => {
    const update = {
      date: "2026-10-01",
      kind: "paid" as const,
      price: { minor: 1000, currency: "USD" as const },
      credits: 40,
      note: null,
      expiresOn: "2026-12-01",
      expiryAlertDays: 14 as const,
    };
    const wallet = stub({ costs: {}, topUps: [] });
    await api.updateTopUp("t/1", update);
    expect(wallet.map((call) => `${call.method} ${call.path}`)).toEqual([
      "PUT /api/wallet/top-ups/t%2F1",
    ]);
    expect(wallet[0]?.body).toEqual(update);

    const rule = {
      enabled: true,
      window: "either" as const,
      thresholdPercent: 95 as const,
      minHoursLeft: 12 as const,
    };
    const rules = stub({ autoReset: rule });
    expect(await api.setAutoReset("c1", rule)).toEqual({ autoReset: rule });
    stub({ autoReset: null });
    expect(await api.clearAutoReset("c1")).toEqual({ autoReset: null });
    expect(rules[0]).toMatchObject({
      method: "PUT",
      path: "/api/connections/c1/auto-reset",
      body: rule,
    });

    const budgets = stub({ budgets: [{ metricKey: "on_demand.used", amount: 50, unit: "USD" }] });
    expect(await api.setBudget("c1", "on_demand.used", 50)).toEqual({
      budgets: [{ metricKey: "on_demand.used", amount: 50, unit: "USD" }],
    });
    await api.clearBudget("c1", "spend.30d");
    expect(budgets.map((call) => `${call.method} ${call.path}`)).toEqual([
      "PUT /api/connections/c1/budgets/on_demand.used",
      "DELETE /api/connections/c1/budgets/spend.30d",
    ]);
    expect(budgets[0]?.body).toEqual({ amount: 50 });
  });
  test("an auto-reset or budget response that does not fit the contract is refused", async () => {
    stub({ autoReset: { enabled: true } });
    expect(
      await failure(
        api.setAutoReset("c1", {
          enabled: true,
          window: "weekly",
          thresholdPercent: 100,
          minHoursLeft: 24,
        }),
      ),
    ).toBe("The server sent an unexpected response");
    stub({ budgets: [{ metricKey: "x", amount: -1, unit: "USD" }] });
    expect(await failure(api.setBudget("c1", "x", 1))).toBe(
      "The server sent an unexpected response",
    );
  });
  test("a wallet response that does not fit the contract is refused", async () => {
    stub({ costs: { c1: { kind: "paid", price: { minor: 0, currency: "USD" } } }, topUps: [] });
    expect(await failure(api.wallet())).toBe("The server sent an unexpected response");
  });
  test("saving the order resolves with its body and makes no request", async () => {
    devicePrefs().setDemo(true);
    const calls = stub({});
    const order: OrderBody = { providers: ["codex", "claude"], accounts: { codex: ["demo-a"] } };
    expect(await api.saveOrder(order)).toEqual(order);
    expect(calls).toEqual([]);
  });
  test("reads and real settings stay real, and real ids still load", async () => {
    devicePrefs().setDemo(true);
    const calls = stub({ settings: defaultSettings });
    await api.settings();
    await api.saveSettings(defaultSettings);
    stub({ error: "not_found" }, 404);
    expect(await failure(api.connection("real-1"))).toBe("Request failed (404)");
    expect(calls.map((call) => call.path)).toEqual(["/api/settings", "/api/settings"]);
  });
  test("with Demo Mode off the calls go to the server", async () => {
    const calls = stub({ state: "paused" });
    await api.pause("c1", true);
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/connections/c1/pause",
      body: { paused: true },
    });
    expect(isDemoId("demo-1")).toBe(true);
    expect(isDemoId("c1")).toBe(false);
  });
});
