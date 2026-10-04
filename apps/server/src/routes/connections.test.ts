import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  credentialFixture,
  FakeConnector,
  okCollect,
  rateLimitError,
} from "@headroom/core/testing";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

const attemptSchema = z.object({
  attempt: z.object({
    id: z.string(),
    state: z.string(),
    nextStep: z.object({ kind: z.string() }).nullable(),
    connectionId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});
const listSchema = z.object({
  connections: z.array(
    z.object({ id: z.string(), state: z.string(), stale: z.boolean(), metricCount: z.number() }),
  ),
});

async function harness() {
  const connector = new FakeConnector("codex");
  // Fixed clock just after the fake connector's observation time so staleness is deterministic.
  const ctx = testContext({}, { connectors: [connector], now: () => new Date(1_700_000_060_000) });
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const get = (path: string) => app.request(url(ctx, path), { headers: { cookie } });
  const post = (path: string, body: unknown = {}) =>
    app.request(url(ctx, path), jsonPost(ctx, body, { cookie }));
  return { connector, ctx, app, cookie, get, post };
}

describe("providers and attempts", () => {
  test("everything requires a session", async () => {
    const { ctx, app } = await harness();
    expect((await app.request(url(ctx, "/api/providers"))).status).toBe(401);
    expect((await app.request(url(ctx, "/api/connections"))).status).toBe(401);
    expect((await app.request(url(ctx, "/api/attempts"), jsonPost(ctx, {}))).status).toBe(401);
  });

  test("only enabled connectors are listed and usable", async () => {
    const { get, post } = await harness();
    const providers = z
      .object({
        providers: z.array(z.object({ provider: z.string(), methods: z.array(z.string()) })),
      })
      .parse(await (await get("/api/providers")).json());
    expect(providers.providers.map((p) => p.provider)).toEqual(["codex"]);
    expect(
      (await post("/api/attempts", { provider: "claude", method: "device_code" })).status,
    ).toBe(404);
    expect(
      (await post("/api/attempts", { provider: "codex", method: "paste_redirect" })).status,
    ).toBe(400);
    expect((await post("/api/attempts", { provider: "codex", method: "nope" })).status).toBe(400);
  });

  test("device-code attempt through to a ready connection, then list and detail", async () => {
    const { connector, get, post } = await harness();
    const begun = attemptSchema.parse(
      await (await post("/api/attempts", { provider: "codex", method: "device_code" })).json(),
    );
    expect(begun.attempt.state).toBe("awaiting_user");
    expect(begun.attempt.nextStep?.kind).toBe("device_code");

    connector.pollQueue.push({ status: "credentials", credential: credentialFixture() });
    const polled = attemptSchema.parse(
      await (await get(`/api/attempts/${begun.attempt.id}`)).json(),
    );
    expect(polled.attempt.state).toBe("succeeded");
    const connectionId = polled.attempt.connectionId!;

    const list = listSchema.parse(await (await get("/api/connections")).json());
    expect(list.connections).toHaveLength(1);
    expect(list.connections[0]).toMatchObject({
      id: connectionId,
      state: "ready",
      stale: false,
      metricCount: 1,
    });

    const detail = await get(`/api/connections/${connectionId}`);
    expect(detail.status).toBe(200);
    // Mirrors the web client's detail schema: every instant is epoch milliseconds or null.
    const instant = z.number().nullable();
    const body = z
      .object({
        connection: z.object({ lastSuccessAt: instant, createdAt: z.number() }),
        snapshot: z.object({
          observedAt: z.number(),
          metrics: z.array(
            z.object({
              valueText: z.string().nullable(),
              windowStart: instant,
              windowEnd: instant,
              resetsAt: instant,
            }),
          ),
          resetCredits: z.array(z.object({ expiresAt: instant, cooldownUntil: instant })),
        }),
        capabilities: z.array(z.object({ metricOrAction: z.string(), checkedAt: z.number() })),
        latestRun: z.object({
          startedAt: z.number(),
          finishedAt: instant,
          outcome: z.string(),
          sanitizedError: z.string().nullable(),
        }),
      })
      .parse(await detail.json());
    expect(body.snapshot.metrics[0]?.valueText).toBe("42.5");
    expect(body.capabilities).toHaveLength(1);
    expect((await get("/api/connections/does-not-exist")).status).toBe(404);
  });

  test("api-key attempt takes pasted input and refuses input in the wrong state", async () => {
    const { connector, post } = await harness();
    connector.beginQueue.push({
      status: "next_step",
      nextStep: {
        kind: "api_key",
        keyPageUrl: "https://example.com/keys",
        fields: [{ name: "key", label: "Key", secret: true }],
      },
      privateState: null,
    });
    const begun = attemptSchema.parse(
      await (await post("/api/attempts", { provider: "codex", method: "api_key" })).json(),
    );
    expect(begun.attempt.state).toBe("awaiting_input");
    const bad = await post(`/api/attempts/${begun.attempt.id}/input`, {
      input: { kind: "nonsense" },
    });
    expect(bad.status).toBe(400);
    const done = attemptSchema.parse(
      await (
        await post(`/api/attempts/${begun.attempt.id}/input`, {
          input: { kind: "api_key", values: { key: "k" } },
        })
      ).json(),
    );
    expect(done.attempt.state).toBe("succeeded");
    expect(
      (
        await post(`/api/attempts/${begun.attempt.id}/input`, {
          input: { kind: "code", value: "x" },
        })
      ).status,
    ).toBe(409);
    expect((await post(`/api/attempts/${begun.attempt.id}/cancel`)).status).toBe(409);
  });
});

/** A promise opened from outside, to hold a fake connector call until the test says so. */
function gate() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, open: resolve };
}

async function connected() {
  const h = await harness();
  h.connector.beginQueue.push({ status: "credentials", credential: credentialFixture() });
  const begun = attemptSchema.parse(
    await (await h.post("/api/attempts", { provider: "codex", method: "import" })).json(),
  );
  return { ...h, connectionId: begun.attempt.connectionId! };
}

describe("connection actions", () => {
  test("manual refresh runs a collection; a transient failure leaves the state alone", async () => {
    const { connector, post, connectionId } = await connected();
    connector.collectQueue.push(okCollect("9"));
    const ok = z
      .object({
        outcome: z.object({ status: z.string(), outcome: z.string().optional() }),
        state: z.string(),
      })
      .parse(await (await post(`/api/connections/${connectionId}/refresh`)).json());
    expect(ok).toEqual({ outcome: { status: "collected", outcome: "succeeded" }, state: "ready" });
    connector.collectQueue.push(rateLimitError());
    const limited = z
      .object({ outcome: z.object({ status: z.string() }), state: z.string() })
      .parse(await (await post(`/api/connections/${connectionId}/refresh`)).json());
    expect(limited.outcome.status).toBe("failed");
    expect(limited.state).toBe("ready");
  });

  test("pause and resume; reconnect only when required", async () => {
    const { ctx, connector, post, connectionId } = await connected();
    expect(
      await (await post(`/api/connections/${connectionId}/pause`, { paused: true })).json(),
    ).toEqual({ state: "paused" });
    expect(
      await (await post(`/api/connections/${connectionId}/pause`, { paused: false })).json(),
    ).toEqual({ state: "ready" });
    expect(
      (await post(`/api/connections/${connectionId}/reconnect`, { method: "import" })).status,
    ).toBe(409);
    ctx.connections.requireReconnect(connectionId, "token_rejected");
    connector.beginQueue.push({ status: "credentials", credential: credentialFixture("new") });
    const reconnect = await post(`/api/connections/${connectionId}/reconnect`, {
      method: "import",
    });
    expect(reconnect.status).toBe(201);
    const attempt = attemptSchema.parse(await reconnect.json());
    expect(attempt.attempt.connectionId).toBe(connectionId);
    expect(attempt.attempt.state).toBe("succeeded");
    expect(ctx.connections.get(connectionId)?.state).toBe("ready");
  });

  test("disconnect reports the revocation result and removes everything", async () => {
    const { ctx, app, cookie, connector, connectionId } = await connected();
    connector.disconnectResult = "revoked";
    const response = await app.request(url(ctx, `/api/connections/${connectionId}`), {
      method: "DELETE",
      headers: { cookie, origin: url(ctx, "") },
    });
    expect(await response.json()).toEqual({ revocation: "revoked" });
    expect(ctx.connections.get(connectionId)).toBeNull();
    expect(ctx.credentials.get(connectionId)).toBeNull();
    expect(ctx.snapshots.latest(connectionId)).toBeNull();
  });

  test("two concurrent manual refreshes collect once; the second finds the lease held", async () => {
    const { connector, post, connectionId } = await connected();
    // Connecting ran one collection already.
    connector.calls.length = 0;
    const started = gate();
    const finish = gate();
    connector.collect = () => {
      connector.calls.push("collect");
      started.open();
      return finish.promise.then(() => okCollect());
    };
    const first = post(`/api/connections/${connectionId}/refresh`);
    await started.promise;
    const second = await post(`/api/connections/${connectionId}/refresh`);
    expect(await second.json()).toMatchObject({
      outcome: { status: "skipped", reason: "lease_held" },
    });
    finish.open();
    expect((await first).status).toBe(200);
    expect(connector.calls.filter((call) => call === "collect")).toHaveLength(1);
  });

  test("disconnect waits for a collection in flight instead of failing it", async () => {
    const { connector, ctx, app, cookie, post, connectionId } = await connected();
    connector.calls.length = 0;
    const started = gate();
    const finish = gate();
    connector.collect = () => {
      connector.calls.push("collect");
      started.open();
      return finish.promise.then(() => okCollect());
    };
    const refresh = post(`/api/connections/${connectionId}/refresh`);
    await started.promise;
    const disconnect = app.request(url(ctx, `/api/connections/${connectionId}`), {
      method: "DELETE",
      headers: { cookie, origin: url(ctx, "") },
    });
    await Bun.sleep(30);
    expect(ctx.connections.get(connectionId)).not.toBeNull();
    finish.open();
    expect((await refresh).status).toBe(200);
    expect((await disconnect).status).toBe(200);
    expect(ctx.connections.get(connectionId)).toBeNull();
  });

  test("disconnect answers 409 connection_busy when the lease stays held", async () => {
    const { ctx, cookie, connector, connectionId } = await connected();
    const busy = { ...ctx, disconnectWaitMs: 40 };
    const busyApp = createApp(busy);
    expect(ctx.leases.acquire(connectionId, "collect:other", 60_000)).toBe(true);
    const response = await busyApp.request(url(ctx, `/api/connections/${connectionId}`), {
      method: "DELETE",
      headers: { cookie, origin: url(ctx, "") },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "connection_busy" });
    expect(ctx.connections.get(connectionId)).not.toBeNull();
    expect(connector.calls).not.toContain("disconnect");
  });
});
