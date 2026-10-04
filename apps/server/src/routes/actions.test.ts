import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { credentialFixture, FakeConnector } from "@headroom/core/testing";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

const creditSnapshot = {
  observedAt: 1_700_000_000_000,
  metrics: [],
  resetCredits: [
    { providerCreditId: "credit-1", eligible: true, usable: true, expiresAt: 1_700_900_000_000 },
  ],
  failures: [],
};

async function connectedCodex(env: Record<string, string>) {
  const connector = new FakeConnector("codex");
  connector.collectQueue.push(creditSnapshot);
  connector.beginQueue.push({ status: "credentials", credential: credentialFixture() });
  const ctx = testContext(env, { connectors: [connector] });
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const begun = await app.request(
    url(ctx, "/api/attempts"),
    jsonPost(ctx, { provider: "codex", method: "import" }, { cookie }),
  );
  const { attempt } = z
    .object({ attempt: z.object({ connectionId: z.string() }) })
    .parse(await begun.json());
  return { ctx, app, cookie, connector, connectionId: attempt.connectionId };
}

/** The owner switches account actions on in Settings; that is the only gate. */
function allowActions(ctx: ReturnType<typeof testContext>): void {
  ctx.settings.put({ ...ctx.settings.get(), accountActions: true });
}

describe("account actions route", () => {
  test("the detail payload says whether actions are on and what the connector supports", async () => {
    const off = await connectedCodex({});
    const detail = await off.app.request(url(off.ctx, `/api/connections/${off.connectionId}`), {
      headers: { cookie: off.cookie },
    });
    expect(z.object({ actions: z.unknown() }).parse(await detail.json()).actions).toEqual({
      enabled: false,
      supported: ["consume_reset_credit"],
    });
  });

  test("with actions off the route answers 403 and records nothing", async () => {
    const s = await connectedCodex({});
    const response = await s.app.request(
      url(s.ctx, `/api/connections/${s.connectionId}/actions`),
      jsonPost(
        s.ctx,
        { action: "consume_reset_credit", creditId: "credit-1", confirm: true },
        { cookie: s.cookie },
      ),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "actions_disabled" });
    expect(s.connector.calls.some((c) => c.startsWith("action:"))).toBe(false);
  });

  test("with actions on, a confirmed consume runs once and is followed by a collection", async () => {
    const s = await connectedCodex({});
    allowActions(s.ctx);
    const unconfirmed = await s.app.request(
      url(s.ctx, `/api/connections/${s.connectionId}/actions`),
      jsonPost(
        s.ctx,
        { action: "consume_reset_credit", creditId: "credit-1", confirm: false },
        { cookie: s.cookie },
      ),
    );
    expect(unconfirmed.status).toBe(400);

    const response = await s.app.request(
      url(s.ctx, `/api/connections/${s.connectionId}/actions`),
      jsonPost(
        s.ctx,
        { action: "consume_reset_credit", creditId: "credit-1", confirm: true },
        { cookie: s.cookie },
      ),
    );
    expect(response.status).toBe(200);
    const body = z
      .object({
        action: z.object({
          state: z.string(),
          providerReference: z.string().nullable(),
          requestedAt: z.number(),
          completedAt: z.number().nullable(),
        }),
        collection: z.object({ status: z.string() }).nullable(),
        state: z.string(),
      })
      .parse(await response.json());
    expect(body.action.state).toBe("succeeded");
    expect(body.action.providerReference).toBe("credit-1");
    expect(body.collection?.status).toBe("collected");
    expect(s.connector.calls.filter((c) => c.startsWith("action:"))).toHaveLength(1);
    expect(s.connector.calls.filter((c) => c === "collect")).toHaveLength(2);
  });

  test("the owner setting is the only gate: off answers 403, switching it on allows the action", async () => {
    const s = await connectedCodex({});
    const send = () =>
      s.app.request(
        url(s.ctx, `/api/connections/${s.connectionId}/actions`),
        jsonPost(
          s.ctx,
          { action: "consume_reset_credit", creditId: "credit-1", confirm: true },
          { cookie: s.cookie },
        ),
      );
    const blocked = await send();
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "actions_disabled" });
    expect(s.connector.calls.some((c) => c.startsWith("action:"))).toBe(false);

    allowActions(s.ctx);
    expect((await send()).status).toBe(200);
    expect(s.connector.calls.filter((c) => c.startsWith("action:"))).toHaveLength(1);
  });

  test("a signed-out caller cannot trigger an action", async () => {
    const s = await connectedCodex({});
    const response = await s.app.request(
      url(s.ctx, `/api/connections/${s.connectionId}/actions`),
      jsonPost(s.ctx, { action: "consume_reset_credit", creditId: "credit-1", confirm: true }),
    );
    expect(response.status).toBe(401);
    expect(s.connector.calls.some((c) => c.startsWith("action:"))).toBe(false);
  });
});
