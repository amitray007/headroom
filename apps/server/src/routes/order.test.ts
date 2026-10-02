import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { credentialFixture, FakeConnector } from "@headroom/core/testing";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

type Provider = "codex" | "claude";

async function harness() {
  const ctx = testContext(
    { HEADROOM_ENABLED_PROVIDERS: "codex,claude" },
    { connectors: [new FakeConnector("codex"), new FakeConnector("claude")] },
  );
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const get = (path: string) => app.request(url(ctx, path), { headers: { cookie } });
  const put = async (body: unknown) =>
    await app.request(url(ctx, "/api/order"), {
      ...jsonPost(ctx, body, { cookie }),
      method: "PUT",
    });
  let tick = 1_700_000_000_000;
  const add = (provider: Provider, id: string) => {
    const row = ctx.connections.create({
      provider,
      identity: { providerAccountId: id, workspaceId: null, label: id, assurance: "strong" },
      scope: "individual",
      authMethod: "import",
      interface: "private",
      connectorVersion: "fake-1",
    });
    ctx.credentials.put(row.id, credentialFixture());
    // Distinct creation times keep the default order explicit.
    ctx.sqlite.run("UPDATE connections SET created_at = ? WHERE id = ?", [tick++, row.id]);
    return row;
  };
  const overview = async () =>
    z
      .object({
        connections: z.array(z.object({ id: z.string() })),
        providerOrder: z.array(z.string()),
      })
      .parse(await (await get("/api/overview")).json());
  return { ctx, app, put, get, add, overview };
}

const effectiveSchema = z.object({
  providers: z.array(z.string()),
  accounts: z.record(z.string(), z.array(z.string())),
});

describe("PUT /api/order", () => {
  test("needs a session", async () => {
    const h = await harness();
    const body = { providers: [], accounts: {} };
    const anonymous = await h.app.request(url(h.ctx, "/api/order"), {
      ...jsonPost(h.ctx, body),
      method: "PUT",
    });
    expect(anonymous.status).toBe(401);
  });

  test("rejects unknown providers, duplicates, wrong-provider and unknown ids", async () => {
    const h = await harness();
    const a = h.add("codex", "a");
    const b = h.add("codex", "b");
    const c = h.add("claude", "c");
    const bad: unknown[] = [
      { providers: ["nope"], accounts: {} },
      { providers: ["codex", "codex"], accounts: {} },
      { providers: [], accounts: { nope: [] } },
      { providers: [], accounts: { codex: [a.id, a.id] } },
      { providers: [], accounts: { codex: [c.id] } },
      { providers: [], accounts: { codex: ["missing"] } },
      { providers: [] },
      null,
    ];
    const responses = await Promise.all(bad.map((body) => h.put(body)));
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(responses.map((response) => response.status)).toEqual(bad.map(() => 400));
    expect(bodies).toEqual(bad.map(() => ({ error: "invalid_body" })));
    expect((await h.overview()).connections.map((row) => row.id)).toEqual([a.id, b.id, c.id]);
  });

  test("a full reorder shows in the overview and the connection list", async () => {
    const h = await harness();
    const a = h.add("codex", "a");
    const b = h.add("codex", "b");
    const c = h.add("claude", "c");
    const d = h.add("claude", "d");
    const response = await h.put({
      providers: ["claude", "codex"],
      accounts: { codex: [b.id, a.id], claude: [d.id, c.id] },
    });
    expect(response.status).toBe(200);
    const effective = effectiveSchema.parse(await response.json());
    expect(effective.providers.slice(0, 2)).toEqual(["claude", "codex"]);
    expect(effective.accounts).toEqual({ claude: [d.id, c.id], codex: [b.id, a.id] });

    const overview = await h.overview();
    expect(overview.providerOrder.slice(0, 2)).toEqual(["claude", "codex"]);
    expect(overview.connections.map((row) => row.id)).toEqual([d.id, c.id, b.id, a.id]);
    const list = z
      .object({ connections: z.array(z.object({ id: z.string() })) })
      .parse(await (await h.get("/api/connections")).json());
    expect(list.connections.map((row) => row.id)).toEqual([d.id, c.id, b.id, a.id]);
  });

  test("partial input keeps the rest in default order after the listed ones", async () => {
    const h = await harness();
    const a = h.add("codex", "a");
    const b = h.add("codex", "b");
    const c = h.add("codex", "c");
    const x = h.add("claude", "x");
    const response = await h.put({ providers: ["claude"], accounts: { codex: [c.id] } });
    const effective = effectiveSchema.parse(await response.json());
    expect(effective.providers[0]).toBe("claude");
    expect(effective.providers.indexOf("codex")).toBe(1);
    expect(effective.accounts["codex"]).toEqual([c.id, a.id, b.id]);
    expect(effective.accounts["claude"]).toEqual([x.id]);
    expect((await h.overview()).connections.map((row) => row.id)).toEqual([x.id, c.id, a.id, b.id]);

    // Listing no providers keeps the stored provider order.
    await h.put({ providers: [], accounts: {} });
    expect((await h.overview()).providerOrder[0]).toBe("claude");
  });

  test("a new connection lands last in its provider; reconnect and disconnect keep order", async () => {
    const h = await harness();
    const a = h.add("codex", "a");
    const b = h.add("codex", "b");
    await h.put({ providers: [], accounts: { codex: [b.id, a.id] } });
    const c = h.add("codex", "c");
    expect(c.position).toBeNull();
    expect((await h.overview()).connections.map((row) => row.id)).toEqual([b.id, a.id, c.id]);

    h.ctx.connections.reconnected(
      b.id,
      { providerAccountId: "b", workspaceId: null, label: "b2", assurance: "strong" },
      "import",
      "fake-1",
    );
    expect(h.ctx.connections.get(b.id)?.position).toBe(0);
    expect((await h.overview()).connections.map((row) => row.id)).toEqual([b.id, a.id, c.id]);

    h.ctx.connections.delete(a.id);
    expect((await h.overview()).connections.map((row) => row.id)).toEqual([b.id, c.id]);
  });

  test("a bad entry changes nothing", async () => {
    const h = await harness();
    const a = h.add("codex", "a");
    const b = h.add("codex", "b");
    const c = h.add("claude", "c");
    await h.put({ providers: ["codex", "claude"], accounts: { codex: [a.id, b.id] } });
    const before = await h.overview();
    const response = await h.put({
      providers: ["claude", "codex"],
      accounts: { codex: [b.id, a.id], claude: [c.id, "missing"] },
    });
    expect(response.status).toBe(400);
    expect(await h.overview()).toEqual(before);
    expect(h.ctx.connections.get(a.id)?.position).toBe(0);
  });

  test("saving settings leaves the order alone", async () => {
    const h = await harness();
    h.add("codex", "a");
    await h.put({ providers: ["claude"], accounts: {} });
    const settings = h.ctx.settings.get();
    h.ctx.settings.put({ ...settings, density: "compact" });
    expect((await h.overview()).providerOrder[0]).toBe("claude");
  });
});
