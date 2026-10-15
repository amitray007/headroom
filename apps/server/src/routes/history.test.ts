import { describe, expect, test } from "bun:test";

import { historyWireSchema } from "@headroom/view-model/history";
import { credentialFixture, FakeConnector } from "@headroom/core/testing";

import { createApp } from "../app.ts";
import { signedIn, testContext, url } from "../test-helpers.ts";

const now = 1_700_000_060_000;
const day = 86_400_000;

async function harness() {
  const codex = new FakeConnector("codex");
  const clock = { at: now };
  const ctx = testContext(
    { HEADROOM_ENABLED_PROVIDERS: "codex" },
    { connectors: [codex], now: () => new Date(clock.at) },
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
  return { ctx, app, get, add, cookie, clock };
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
    const body = historyWireSchema.parse(await response.json());
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
    expect(historyWireSchema.parse(await (await h.get("/api/history")).json()).from).toBe(
      now - 90 * day,
    );
    const bad = ["1", "0", "abc", "-7", "7.5", ""];
    const responses = await Promise.all(
      bad.map(async (days) => await h.get(`/api/history?days=${days}`)),
    );
    expect(responses.map((response) => response.status)).toEqual(bad.map(() => 400));
    expect(await responses[0]?.json()).toEqual({ error: "invalid_days" });
  });

  test("validates tz as whole minutes from -720 to 840", async () => {
    const h = await harness();
    const bad = ["abc", "5.5", "841", "-721", "", "1e3"];
    const responses = await Promise.all(
      bad.map(async (tz) => await h.get(`/api/history?tz=${tz}`)),
    );
    expect(responses.map((response) => response.status)).toEqual(bad.map(() => 400));
    expect(await responses[0]?.json()).toEqual({ error: "invalid_tz" });
    expect((await h.get("/api/history?tz=330")).status).toBe(200);
    expect((await h.get("/api/history?tz=-720")).status).toBe(200);
  });

  test("buckets start on local hours for the given tz", async () => {
    const h = await harness();
    const row = h.add("a1");
    await h.ctx.collection.run(row.id, "test");
    const at = async (path: string) => await (await h.get(path)).json();
    const utc = historyWireSchema.parse(await at("/api/history"));
    const ist = historyWireSchema.parse(await at("/api/history?tz=330"));
    const hour = 3_600_000;
    const utcBucket = utc.connections[0]?.series[0]?.points[0]?.[0] ?? 0;
    const istBucket = ist.connections[0]?.series[0]?.points[0]?.[0] ?? 0;
    expect(utcBucket % hour).toBe(0);
    expect((istBucket + 330 * 60_000) % hour).toBe(0);
    expect(istBucket).toBeLessThanOrEqual(now);
    expect(now - istBucket).toBeLessThan(hour);
  });

  test("serves a cached body until a new snapshot arrives", async () => {
    const h = await harness();
    const row = h.add("a1");
    await h.ctx.collection.run(row.id, "test");
    const first = await (await h.get("/api/history")).text();
    expect(await (await h.get("/api/history")).text()).toBe(first);
    h.clock.at = now + 2_000;
    h.ctx.sqlite.run(
      "INSERT INTO sync_runs (id, connection_id, started_at, finished_at, outcome) VALUES ('failed-run', ?, ?, ?, 'rate_limited')",
      [row.id, now + 1_000, now + 1_100],
    );
    const after = historyWireSchema.parse(await (await h.get("/api/history")).json());
    expect(after.connections[0]?.failures).toEqual([{ at: now + 1_000, outcome: "rate_limited" }]);
  });

  test("gzips the body when the client accepts it", async () => {
    const h = await harness();
    for (let i = 0; i < 40; i++) h.add(`acct${i}`);
    const response = await h.app.request(url(h.ctx, "/api/history"), {
      headers: { cookie: h.cookie, "accept-encoding": "gzip" },
    });
    expect(response.headers.get("content-encoding")).toBe("gzip");
    const raw = new Uint8Array(await response.arrayBuffer());
    expect(raw[0]).toBe(0x1f);
    expect(raw[1]).toBe(0x8b);
    const text = new TextDecoder().decode(Bun.gunzipSync(raw));
    expect(historyWireSchema.parse(JSON.parse(text)).connections).toHaveLength(40);
  });
});
