import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { credentialFixture, FakeConnector, okCollect } from "@headroom/core/testing";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

const now = 1_700_000_060_000;

function identity(provider: string, id: string, label: string) {
  return {
    provider,
    identity: { providerAccountId: id, workspaceId: null, label, assurance: "strong" as const },
  };
}

async function harness(env: Record<string, string> = {}) {
  const codex = new FakeConnector("codex");
  const claude = new FakeConnector("claude");
  const ctx = testContext(
    { HEADROOM_ENABLED_PROVIDERS: "codex,claude", ...env },
    { connectors: [codex, claude], now: () => new Date(now) },
  );
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const get = (path: string) => app.request(url(ctx, path), { headers: { cookie } });
  const send = (method: string, path: string, body: unknown) =>
    app.request(url(ctx, path), {
      ...jsonPost(ctx, body, { cookie }),
      method,
    });
  return { ctx, app, cookie, codex, claude, get, send };
}

type Harness = Awaited<ReturnType<typeof harness>>;

function addConnection(h: Harness, provider: "codex" | "claude", id: string, label: string) {
  const row = h.ctx.connections.create({
    ...identity(provider, id, label),
    provider,
    scope: "individual",
    authMethod: "import",
    interface: "private",
    connectorVersion: "fake-1",
  });
  h.ctx.credentials.put(row.id, credentialFixture());
  return row;
}

const overviewSchema = z.object({
  connections: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      name: z.string().nullable(),
      identity: z.string().nullable(),
      plan: z.string().nullable(),
      createdAt: z.number(),
      stale: z.boolean(),
      latestRun: z
        .object({
          startedAt: z.number(),
          finishedAt: z.number().nullable(),
          outcome: z.string().nullable(),
          error: z.string().nullable(),
        })
        .nullable(),
      snapshot: z
        .object({
          observedAt: z.number(),
          metrics: z.array(
            z.object({ providerMetricKey: z.string(), valueNum: z.number().nullable() }),
          ),
          resetCredits: z.array(z.object({ providerCreditId: z.string() })),
        })
        .nullable(),
      actions: z.object({ enabled: z.boolean(), supported: z.array(z.string()) }),
    }),
  ),
  refreshIntervalMs: z.number(),
  staleAfterMs: z.number(),
});

describe("GET /api/overview", () => {
  test("requires a session", async () => {
    const h = await harness();
    expect((await h.app.request(url(h.ctx, "/api/overview"))).status).toBe(401);
  });

  test("one call carries every account with its snapshot, ordered by provider then creation", async () => {
    const h = await harness();
    // Created out of provider order on purpose; codex precedes claude in enums.ts.
    const claude = addConnection(h, "claude", "a1", "owner@acme.example (max)");
    const codexA = addConnection(h, "codex", "a2", "Codex (plus)");
    const codexB = addConnection(h, "codex", "a3", "second@example.com (pro)");
    await h.ctx.collection.run(codexA.id, "test");
    h.codex.collectQueue.push(okCollect("10"));

    const body = overviewSchema.parse(await (await h.get("/api/overview")).json());
    expect(body.connections.map((c) => c.id)).toEqual([codexA.id, codexB.id, claude.id]);
    expect(body.refreshIntervalMs).toBe(900_000);
    expect(body.staleAfterMs).toBe(43_200_000);

    const [first, second, third] = body.connections;
    expect(first?.identity).toBeNull();
    expect(first?.plan).toBe("plus");
    expect(first?.name).toBeNull();
    expect(first?.snapshot?.metrics[0]).toMatchObject({
      providerMetricKey: "weekly",
      valueNum: 42.5,
    });
    expect(first?.snapshot?.resetCredits).toEqual([
      expect.objectContaining({ providerCreditId: "rc-1" }),
    ]);
    expect(first?.latestRun?.outcome).toBe("succeeded");
    expect(first?.actions).toEqual({ enabled: false, supported: ["consume_reset_credit"] });
    expect(second).toMatchObject({
      identity: "second@example.com",
      plan: "pro",
      snapshot: null,
      latestRun: null,
    });
    expect(third).toMatchObject({ identity: "owner@acme.example", plan: "max" });
  });

  test("the response never carries provider account identifiers", async () => {
    const h = await harness();
    addConnection(h, "codex", "secret-account-id", "owner@example.com (pro)");
    const text = await (await h.get("/api/overview")).text();
    expect(text).not.toContain("secret-account-id");
    expect(text).not.toContain("providerAccountId");
  });

  test("reports the interval from settings and the actions setting", async () => {
    const h = await harness();
    addConnection(h, "codex", "a1", "Codex");
    const read = async () => overviewSchema.parse(await (await h.get("/api/overview")).json());
    expect((await read()).connections[0]?.actions.enabled).toBe(false);
    const next = { ...h.ctx.settings.get(), refreshIntervalMinutes: 5, accountActions: true };
    expect((await h.send("PUT", "/api/settings", next)).status).toBe(200);
    const after = await read();
    expect(after.refreshIntervalMs).toBe(300_000);
    expect(after.connections[0]?.actions.enabled).toBe(true);
  });
});

describe("PATCH /api/connections/:id", () => {
  test("sets, trims and clears the name; collection and reconnect leave it alone", async () => {
    const h = await harness();
    const row = addConnection(h, "codex", "a1", "owner@example.com (pro)");
    const patch = (body: unknown) => h.send("PATCH", `/api/connections/${row.id}`, body);

    const set = await patch({ name: "  Work  " });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ name: "Work" });
    await h.ctx.collection.run(row.id, "test");
    h.ctx.connections.reconnected(
      row.id,
      {
        providerAccountId: "a1",
        workspaceId: null,
        label: "owner@example.com (plus)",
        assurance: "strong",
      },
      "import",
      "fake-1",
    );
    const list = z
      .object({ connections: z.array(z.object({ name: z.string().nullable() })) })
      .parse(await (await h.get("/api/connections")).json());
    expect(list.connections[0]?.name).toBe("Work");

    expect(await (await patch({ name: "" })).json()).toEqual({ name: null });
    await patch({ name: "Again" });
    expect(await (await patch({ name: null })).json()).toEqual({ name: null });
    expect(await (await patch({ name: "   " })).json()).toEqual({ name: null });
  });

  test("rejects a name over 40 characters and a bad body, 404 for an unknown id", async () => {
    const h = await harness();
    const row = addConnection(h, "codex", "a1", "Codex");
    const patch = (id: string, body: unknown) => h.send("PATCH", `/api/connections/${id}`, body);
    expect((await patch(row.id, { name: "x".repeat(40) })).status).toBe(200);
    const long = await patch(row.id, { name: "x".repeat(41) });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: "invalid_body" });
    expect((await patch(row.id, { name: 5 })).status).toBe(400);
    expect((await patch(row.id, {})).status).toBe(400);
    expect((await patch("nope", { name: "A" })).status).toBe(404);
  });

  test("needs a session", async () => {
    const h = await harness();
    const row = addConnection(h, "codex", "a1", "Codex");
    const response = await h.app.request(url(h.ctx, `/api/connections/${row.id}`), {
      ...jsonPost(h.ctx, { name: "A" }),
      method: "PATCH",
    });
    expect(response.status).toBe(401);
  });
});

describe("GET /api/connections/:id", () => {
  test("is built field by field: no providerAccountId, workspaceId or connectorVersion", async () => {
    const h = await harness();
    const row = addConnection(h, "codex", "secret-account-id", "owner@example.com (pro)");
    const response = await h.get(`/api/connections/${row.id}`);
    const text = await response.text();
    expect(text).not.toContain("secret-account-id");
    const { connection } = z
      .object({ connection: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(text));
    expect("providerAccountId" in connection).toBe(false);
    expect("workspaceId" in connection).toBe(false);
    expect(Object.keys(connection).toSorted()).toEqual(
      [
        "authMethod",
        "createdAt",
        "id",
        "interface",
        "label",
        "lastSuccessAt",
        "name",
        "provider",
        "reconnectReason",
        "scope",
        "state",
        "updatedAt",
      ].toSorted(),
    );
  });
});

describe("settings routes", () => {
  test("defaults and round trip", async () => {
    const h = await harness({ HEADROOM_REFRESH_INTERVAL_SECONDS: "600" });
    const first = z
      .object({ settings: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(await (await h.get("/api/settings")).json());
    expect(first.settings).toMatchObject({
      limitsView: "used",
      lowThresholdPercent: 30,
      refreshIntervalMinutes: 10,
      timeStyle: "countdown",
      clock: "24h",
      density: "comfortable",
      accountActions: false,
    });
    const next = { ...first.settings, limitsView: "left", clock: "12h" };
    const put = await h.send("PUT", "/api/settings", next);
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ settings: next });
    expect(await (await h.get("/api/settings")).json()).toEqual({ settings: next });
  });

  test("rejects a partial or out-of-range body", async () => {
    const h = await harness();
    const full = h.ctx.settings.get();
    const bodies = [{}, { ...full, refreshIntervalMinutes: 7 }, { ...full, clock: "36h" }, "x"];
    const responses = await Promise.all(
      bodies.map(async (bad) => h.send("PUT", "/api/settings", bad)),
    );
    expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    expect(await Promise.all(responses.map(async (r) => r.json()))).toEqual(
      bodies.map(() => ({ error: "invalid_body" })),
    );
    expect(h.ctx.settings.get()).toEqual(full);
  });

  test("requires a session", async () => {
    const h = await harness();
    expect((await h.app.request(url(h.ctx, "/api/settings"))).status).toBe(401);
  });
});
