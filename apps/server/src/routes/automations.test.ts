import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { Connector } from "@headroom/core";
import { credentialFixture, FakeConnector } from "@headroom/core/testing";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

async function harness(provider: "codex" | "claude" = "codex", withActions = true) {
  const connector: Connector = new FakeConnector(provider);
  const connectors = withActions
    ? [connector]
    : [Object.assign(connector, { performAction: undefined, supportedActions: undefined })];
  const ctx = testContext({}, { connectors });
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const row = ctx.connections.create({
    provider,
    identity: { providerAccountId: "acct", workspaceId: null, label: "acct", assurance: "strong" },
    scope: "individual",
    authMethod: "import",
    interface: "private",
    connectorVersion: "fake-1",
  });
  ctx.credentials.put(row.id, credentialFixture());
  const send = async (method: string, path: string, body?: unknown, withCookie = true) =>
    await app.request(url(ctx, `/api/connections/${path}`), {
      ...jsonPost(ctx, body ?? {}, withCookie ? { cookie } : {}),
      method,
      ...(body === undefined ? { body: undefined } : {}),
    });
  const snapshot = (metrics: { key: string; kind: "spend" | "credits"; unit: string }[]) => {
    const run = ctx.snapshots.startRun(row.id);
    ctx.snapshots.record(
      row.id,
      run.id,
      {
        observedAt: 1_700_000_000_000,
        failures: [],
        metrics: metrics.map((m) => ({
          providerMetricKey: m.key,
          kind: m.kind,
          scope: "month",
          valueText: "12",
          unit: m.unit,
          availability: "available",
          interface: "private",
        })),
      },
      "fake-1",
    );
    ctx.snapshots.finishRun(run.id, "succeeded");
  };
  return { ctx, app, cookie, id: row.id, send, snapshot };
}

const rule = { enabled: true, window: "weekly", thresholdPercent: 95, minHoursLeft: 12 } as const;

describe("PUT/DELETE /api/connections/:id/auto-reset", () => {
  test("needs a session", async () => {
    const h = await harness();
    expect((await h.send("PUT", `${h.id}/auto-reset`, rule, false)).status).toBe(401);
    expect((await h.send("DELETE", `${h.id}/auto-reset`, undefined, false)).status).toBe(401);
  });

  test("sets, replaces and clears the rule", async () => {
    const h = await harness();
    const set = await h.send("PUT", `${h.id}/auto-reset`, rule);
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ autoReset: rule });
    expect(h.ctx.automation.autoReset(h.id)).toEqual(rule);
    const replaced = await h.send("PUT", `${h.id}/auto-reset`, { ...rule, enabled: false });
    expect(await replaced.json()).toEqual({ autoReset: { ...rule, enabled: false } });
    const cleared = await h.send("DELETE", `${h.id}/auto-reset`);
    expect(await cleared.json()).toEqual({ autoReset: null });
    expect(h.ctx.automation.autoReset(h.id)).toBeNull();
  });

  test("400 for a bad body, 404 for an unknown connection", async () => {
    const h = await harness();
    const bodies = [{}, { ...rule, thresholdPercent: 80 }, { ...rule, minHoursLeft: 2 }];
    const responses = await Promise.all(bodies.map((b) => h.send("PUT", `${h.id}/auto-reset`, b)));
    expect(responses.map((r) => r.status)).toEqual([400, 400, 400]);
    expect(await Promise.all(responses.map((r) => r.json()))).toEqual([
      { error: "invalid_body" },
      { error: "invalid_body" },
      { error: "invalid_body" },
    ]);
    const missing = await h.send("PUT", "missing/auto-reset", rule);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "unknown_connection" });
    expect((await h.send("DELETE", "missing/auto-reset")).status).toBe(404);
  });

  test("409 unsupported_action when the connector cannot consume a reset credit", async () => {
    const h = await harness("claude", false);
    const response = await h.send("PUT", `${h.id}/auto-reset`, rule);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "unsupported_action" });
    expect(h.ctx.automation.autoReset(h.id)).toBeNull();
  });
});

describe("PUT/DELETE /api/connections/:id/budgets/:metricKey", () => {
  test("needs a session", async () => {
    const h = await harness();
    expect(
      (await h.send("PUT", `${h.id}/budgets/on_demand.used`, { amount: 5 }, false)).status,
    ).toBe(401);
    expect((await h.send("DELETE", `${h.id}/budgets/x`, undefined, false)).status).toBe(401);
  });

  test("sets a budget in the metric's unit and answers with all budgets", async () => {
    const h = await harness();
    h.snapshot([
      { key: "on_demand.used", kind: "spend", unit: "USD" },
      { key: "spend.30d", kind: "spend", unit: "gateway_credits" },
    ]);
    const first = await h.send("PUT", `${h.id}/budgets/on_demand.used`, { amount: 40 });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      budgets: [{ metricKey: "on_demand.used", amount: 40, unit: "USD" }],
    });
    const second = await h.send("PUT", `${h.id}/budgets/spend.30d`, { amount: 9.5 });
    expect(await second.json()).toEqual({
      budgets: [
        { metricKey: "on_demand.used", amount: 40, unit: "USD" },
        { metricKey: "spend.30d", amount: 9.5, unit: "gateway_credits" },
      ],
    });
    const cleared = await h.send("DELETE", `${h.id}/budgets/on_demand.used`);
    expect(await cleared.json()).toEqual({
      budgets: [{ metricKey: "spend.30d", amount: 9.5, unit: "gateway_credits" }],
    });
  });

  test("409 not_a_spend_metric without a snapshot, for a non-spend metric and for an unusable unit", async () => {
    const h = await harness();
    const none = await h.send("PUT", `${h.id}/budgets/on_demand.used`, { amount: 5 });
    expect(none.status).toBe(409);
    expect(await none.json()).toEqual({ error: "not_a_spend_metric" });
    h.snapshot([
      { key: "credits.balance", kind: "credits", unit: "codex_credits" },
      { key: "weird.spend", kind: "spend", unit: "points" },
    ]);
    const keys = ["credits.balance", "weird.spend", "missing"];
    const responses = await Promise.all(
      keys.map((key) => h.send("PUT", `${h.id}/budgets/${key}`, { amount: 5 })),
    );
    expect(responses.map((r) => r.status)).toEqual([409, 409, 409]);
    expect(h.ctx.automation.budgets(h.id)).toEqual([]);
  });

  test("400 for a bad amount, 404 for an unknown connection", async () => {
    const h = await harness();
    h.snapshot([{ key: "on_demand.used", kind: "spend", unit: "USD" }]);
    const bodies = [{}, { amount: 0 }, { amount: -1 }, { amount: "5" }, { amount: 5, unit: "USD" }];
    const responses = await Promise.all(
      bodies.map((body) => h.send("PUT", `${h.id}/budgets/on_demand.used`, body)),
    );
    expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400, 400]);
    const missing = await h.send("PUT", "missing/budgets/on_demand.used", { amount: 5 });
    expect(missing.status).toBe(404);
    expect((await h.send("DELETE", "missing/budgets/x")).status).toBe(404);
  });
});

describe("GET /api/overview carries events and automation", () => {
  test("includes the account's events, rule and budgets", async () => {
    const h = await harness();
    h.ctx.automation.setAutoReset(h.id, rule);
    h.ctx.accountEvents.record(h.id, h.ctx.now().getTime() - 1000, "credits.balance", {
      kind: "top_up_detected",
      unit: "codex_credits",
      previous: 1,
      current: 11,
      added: 10,
      topUpId: null,
    });
    const response = await h.app.request(url(h.ctx, "/api/overview"), {
      headers: { cookie: h.cookie },
    });
    expect(response.status).toBe(200);
    const body = z
      .object({
        connections: z.array(
          z.object({ id: z.string(), events: z.array(z.unknown()), automation: z.unknown() }),
        ),
      })
      .parse(await response.json());
    const row = body.connections.find((c) => c.id === h.id);
    expect(row?.events).toHaveLength(1);
    expect(row?.automation).toEqual({ autoReset: rule, budgets: [] });
  });
});
