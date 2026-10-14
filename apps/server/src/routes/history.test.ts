import { describe, expect, test } from "bun:test";

import { historySchema } from "@headroom/view-model/history";
import { credentialFixture, FakeConnector } from "@headroom/core/testing";

import { createApp } from "../app.ts";
import { signedIn, testContext, url } from "../test-helpers.ts";

const now = 1_700_000_060_000;
const day = 86_400_000;

async function harness() {
  const codex = new FakeConnector("codex");
  const ctx = testContext(
    { HEADROOM_ENABLED_PROVIDERS: "codex" },
    { connectors: [codex], now: () => new Date(now) },
  );
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const get = (path: string) => app.request(url(ctx, path), { headers: { cookie } });
  const add = (id: string) => {
    const row = ctx.connections.create({
      provider: "codex",
      identity: { providerAccountId: id, workspaceId: null, label: "Codex", assurance: "strong" },
      scope: "individual",
      authMethod: "import",
      interface: "private",
      connectorVersion: "fake-1",
    });
    ctx.credentials.put(row.id, credentialFixture());
    return row;
  };
  return { ctx, app, get, add };
}

describe("GET /api/history", () => {
  test("requires a session", async () => {
    const h = await harness();
    expect((await h.app.request(url(h.ctx, "/api/history"))).status).toBe(401);
  });

  test("returns the contract shape with the range, bucket and retention", async () => {
    const h = await harness();
    const row = h.add("a1");
    h.add("a2");
    await h.ctx.collection.run(row.id, "test");
    const response = await h.get("/api/history?days=30");
    expect(response.status).toBe(200);
    const body = historySchema.parse(await response.json());
    expect(body).toMatchObject({
      from: now - 30 * day,
      to: now,
      bucketMs: 3_600_000,
      retentionDays: 90,
    });
    expect(body.connections.map((c) => c.id)).toContain(row.id);
    const mine = body.connections.find((c) => c.id === row.id);
    expect(mine?.coverage.readings).toBe(1);
    expect(mine?.series[0]).toMatchObject({
      providerMetricKey: "weekly",
      points: [[expect.any(Number), 42.5]],
    });
    const empty = body.connections.find((c) => c.id !== row.id);
    expect(empty).toMatchObject({
      coverage: { firstAt: null, lastAt: null, readings: 0 },
      series: [],
    });
  });

  test("defaults to 90 days and rejects other ranges", async () => {
    const h = await harness();
    expect(historySchema.parse(await (await h.get("/api/history")).json()).from).toBe(
      now - 90 * day,
    );
    const bad = ["1", "0", "abc", "-7", "7.5", ""];
    const responses = await Promise.all(
      bad.map(async (days) => await h.get(`/api/history?days=${days}`)),
    );
    expect(responses.map((response) => response.status)).toEqual(bad.map(() => 400));
    expect(await responses[0]?.json()).toEqual({ error: "invalid_days" });
  });
});
