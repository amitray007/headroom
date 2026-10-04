import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { credentialFixture, FakeConnector } from "@headroom/core/testing";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

async function harness() {
  const ctx = testContext(
    { HEADROOM_ENABLED_PROVIDERS: "codex" },
    { connectors: [new FakeConnector("codex")] },
  );
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const row = ctx.connections.create({
    provider: "codex",
    identity: { providerAccountId: "acct", workspaceId: null, label: "acct", assurance: "strong" },
    scope: "individual",
    authMethod: "import",
    interface: "private",
    connectorVersion: "fake-1",
  });
  ctx.credentials.put(row.id, credentialFixture());
  const send = (method: string, path: string, body?: unknown, withCookie = true) =>
    app.request(url(ctx, `/api/wallet${path}`), {
      ...jsonPost(ctx, body ?? {}, withCookie ? { cookie } : {}),
      method,
      ...(body === undefined ? { body: undefined } : {}),
    });
  return { ctx, app, cookie, id: row.id, send };
}

const paid = {
  kind: "paid",
  price: { minor: 2000, currency: "USD" },
  cycle: "monthly",
  renewsOn: "2026-11-01",
};

describe("/api/wallet", () => {
  test("every route needs a session", async () => {
    const h = await harness();
    const calls = await Promise.all([
      h.send("GET", "", undefined, false),
      h.send("PUT", `/costs/${h.id}`, paid, false),
      h.send("DELETE", `/costs/${h.id}`, undefined, false),
      h.send("POST", "/top-ups", {}, false),
      h.send("DELETE", "/top-ups/x", undefined, false),
      h.send("PUT", "/top-ups/x", {}, false),
    ]);
    expect(calls.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
  });

  test("an empty book", async () => {
    const h = await harness();
    const response = await h.send("GET", "");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ costs: {}, topUps: [] });
  });

  test("set, replace and clear a cost", async () => {
    const h = await harness();
    const set = await h.send("PUT", `/costs/${h.id}`, paid);
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ costs: { [h.id]: paid }, topUps: [] });
    const free = await h.send("PUT", `/costs/${h.id}`, { kind: "free" });
    expect(await free.json()).toEqual({ costs: { [h.id]: { kind: "free" } }, topUps: [] });
    const cleared = await h.send("DELETE", `/costs/${h.id}`);
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ costs: {}, topUps: [] });
    expect((await h.send("DELETE", `/costs/${h.id}`)).status).toBe(200);
  });

  test("a bad cost is 400 and an unknown connection is 404", async () => {
    const h = await harness();
    const bad = await h.send("PUT", `/costs/${h.id}`, { kind: "paid", price: { minor: 0 } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_body" });
    const missing = await h.send("PUT", "/costs/nope", { kind: "free" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "unknown_connection" });
  });

  test("add and remove a top-up", async () => {
    const h = await harness();
    const body = {
      connectionId: h.id,
      date: "2026-10-01",
      kind: "paid",
      price: { minor: 500, currency: "EUR" },
      credits: 10,
      note: " refill ",
    };
    const added = await h.send("POST", "/top-ups", body);
    expect(added.status).toBe(200);
    const book = z
      .object({ topUps: z.array(z.object({ id: z.string() }).loose()) })
      .parse(await added.json());
    expect(book.topUps).toHaveLength(1);
    const id = book.topUps[0]?.id ?? "";
    expect(book.topUps[0]).toEqual({
      ...body,
      note: "refill",
      id,
      source: "owner",
      expiresOn: null,
      expiryAlertDays: null,
    });
    const removed = await h.send("DELETE", `/top-ups/${id}`);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ costs: {}, topUps: [] });
    expect((await h.send("DELETE", `/top-ups/${id}`)).status).toBe(200);
  });

  test("a bad top-up is 400 and an unknown connection is 404", async () => {
    const h = await harness();
    const base = {
      connectionId: h.id,
      date: "2026-10-01",
      kind: "free",
      price: null,
      credits: null,
      note: null,
    };
    const bad = await h.send("POST", "/top-ups", { ...base, date: "2026-02-30" });
    expect(bad.status).toBe(400);
    const wrongPrice = await h.send("POST", "/top-ups", { ...base, kind: "paid" });
    expect(wrongPrice.status).toBe(400);
    const missing = await h.send("POST", "/top-ups", { ...base, connectionId: "nope" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "unknown_connection" });
  });

  test("a cross-site write is refused", async () => {
    const h = await harness();
    const response = await h.app.request(url(h.ctx, `/api/wallet/costs/${h.id}`), {
      ...jsonPost(h.ctx, { kind: "free" }, { cookie: h.cookie, origin: "https://evil.example" }),
      method: "PUT",
    });
    expect(response.status).toBe(403);
  });

  test("PUT /top-ups/:id edits a top-up, keeps its source and enforces the price rule", async () => {
    const h = await harness();
    const added = z.object({ topUps: z.array(z.object({ id: z.string() }).loose()) }).parse(
      await (
        await h.send("POST", "/top-ups", {
          connectionId: h.id,
          date: "2026-10-01",
          kind: "free",
          price: null,
          credits: 5,
          note: null,
        })
      ).json(),
    );
    const id = added.topUps[0]?.id ?? "";
    const edit = {
      date: "2026-10-02",
      kind: "paid",
      price: { minor: 900, currency: "USD" },
      credits: 6,
      note: null,
      expiresOn: "2026-12-01",
      expiryAlertDays: 14,
    };
    const ok = await h.send("PUT", `/top-ups/${id}`, edit);
    expect(ok.status).toBe(200);
    const book = z
      .object({ topUps: z.array(z.record(z.string(), z.unknown())) })
      .parse(await ok.json());
    expect(book.topUps[0]).toMatchObject({
      id,
      connectionId: h.id,
      source: "owner",
      credits: 6,
      expiresOn: "2026-12-01",
      expiryAlertDays: 14,
    });
    // An owner entry cannot be paid without a price.
    expect((await h.send("PUT", `/top-ups/${id}`, { ...edit, price: null })).status).toBe(400);
    expect((await h.send("PUT", `/top-ups/${id}`, { ...edit, kind: "nope" })).status).toBe(400);
    const missing = await h.send("PUT", "/top-ups/missing", edit);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "unknown_top_up" });
  });

  test("a detected paid top-up may stay unpriced after an edit and keeps its mark", async () => {
    const h = await harness();
    const topUp = h.ctx.wallet.addTopUp(
      {
        connectionId: h.id,
        date: "2026-10-01",
        kind: "paid",
        price: null,
        credits: 3,
        note: null,
      },
      "detected",
    );
    const response = await h.send("PUT", `/top-ups/${topUp.id}`, {
      date: "2026-10-01",
      kind: "paid",
      price: null,
      credits: 3,
      note: "from an invoice",
      expiresOn: null,
      expiryAlertDays: null,
    });
    expect(response.status).toBe(200);
    const [row] = h.ctx.wallet.book().topUps;
    expect(row).toMatchObject({ source: "detected", note: "from an invoice", price: null });
  });
});
