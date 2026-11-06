import { expect, test } from "bun:test";
import { createZaiConnector } from "@headroom/connector-zai";
import quota from "../../../packages/connectors/zai/src/fixtures/success.json";
import init from "../../../packages/connectors/zai/src/fixtures/oauth-init.json";
import ready from "../../../packages/connectors/zai/src/fixtures/oauth-ready.json";
import resets from "../../../packages/connectors/zai/src/fixtures/resets.json";
import { testContext } from "./test-helpers.ts";

function context() {
  let status = 200,
    businessStatus = 200,
    resetStatus = 200,
    clock = 1800000000000;
  let accountId = "synthetic-customer-alpha",
    accessToken = "synthetic-business-token";
  const calls: { url: string; authorization: string | null; resetBusiness: string | null }[] = [];
  const connector = createZaiConnector({
    now: () => clock,
    fetch: (input, request) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({
        url,
        authorization: new Headers(request?.headers).get("authorization"),
        resetBusiness: new Headers(request?.headers).get("X-Bigmodel-Authorization"),
      });
      const body = url.endsWith("/cli/init")
        ? { ...init, data: { ...init.data, expires_at: clock / 1000 + 300 } }
        : url.includes("/cli/poll/")
          ? ready
          : url.endsWith("/auth/z/login")
            ? { code: 200, data: { access_token: accessToken, expires_in: 3600 } }
            : url.endsWith("/getCustomerInfo")
              ? { code: 200, data: { customerNumber: accountId } }
              : url.endsWith("/reset/status")
                ? resets
                : quota;
      const responseStatus = url.endsWith("/auth/z/login")
        ? businessStatus
        : url.endsWith("/quota/limit")
          ? status
          : url.endsWith("/reset/status")
            ? resetStatus
            : 200;
      return Promise.resolve(
        Response.json(responseStatus === 200 ? body : {}, { status: responseStatus }),
      );
    },
  });
  const ctx = testContext({}, { connectors: [connector], now: () => new Date(clock) });
  async function approve(connectionId?: string) {
    const begin = await ctx.connect.begin({
      provider: "zai",
      method: "approval_poll",
      ...(connectionId === undefined ? {} : { connectionId }),
    });
    expect(begin.nextStep?.kind).toBe("open_url");
    expect(JSON.stringify(begin)).not.toContain("synthetic-oauth-token");
    clock += 2000;
    return ctx.connect.poll(begin.id);
  }
  return {
    ctx,
    approve,
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
    account: (id: string) => {
      accountId = id;
    },
    token: (token: string) => {
      accessToken = token;
    },
    resets: (value: number) => {
      resetStatus = value;
    },
    usage: (value: number) => {
      status = value;
    },
    business: (value: number) => {
      businessStatus = value;
    },
  };
}

test("Z.ai browser approval encrypts its session, isolates accounts and keeps same-account reconnect history", async () => {
  const f = context(),
    { ctx } = f;
  try {
    const first = await f.approve();
    expect(first.state).toBe("succeeded");
    const id = first.connectionId;
    if (id === null) throw new Error("Expected connection");
    expect(ctx.connections.get(id)?.providerAccountId).toBe("zai:synthetic-customer-alpha");
    expect(ctx.connections.get(id)?.authMethod).toBe("approval_poll");
    expect(ctx.credentials.get(id)?.secret["oauthAccessToken"]).toBe("synthetic-oauth-token");
    const sealed = ctx.sqlite
      .query<{ ciphertext: Buffer }, []>("SELECT ciphertext FROM credentials")
      .get();
    expect(sealed?.ciphertext.includes(Buffer.from("synthetic-oauth-token"))).toBe(false);
    expect(sealed?.ciphertext.includes(Buffer.from("synthetic-business-token"))).toBe(false);
    expect(JSON.stringify(first)).not.toContain("synthetic-business-token");
    expect(ctx.credentials.get(id)?.secret["zcodeToken"]).toBe(ready.data.token);
    expect(sealed?.ciphertext.includes(Buffer.from(ready.data.token))).toBe(false);
    expect(JSON.stringify(first)).not.toContain(ready.data.token);
    expect(ctx.snapshots.latest(id)?.resetCredits).toHaveLength(3);
    const snapshot = ctx.snapshots.latest(id)?.snapshot.id;
    f.token("synthetic-new-business-token");
    expect(await f.approve(id)).toMatchObject({ state: "succeeded", connectionId: id });
    expect(
      ctx.sqlite
        .query<{ count: number }, [string]>(
          "SELECT count(*) AS count FROM snapshots WHERE connection_id = ?",
        )
        .get(id)?.count,
    ).toBe(2);
    expect(
      ctx.sqlite
        .query<{ id: string }, [string]>("SELECT id FROM snapshots WHERE id = ?")
        .get(snapshot ?? ""),
    ).not.toBeNull();
    f.account("synthetic-customer-beta");
    const wrong = await f.approve(id);
    expect(wrong.state).toBe("failed");
    expect(wrong.error).toContain("identity_mismatch");
    expect(ctx.credentials.get(id)?.secret["accessToken"]).toBe("synthetic-new-business-token");
    expect((await f.approve()).state).toBe("succeeded");
    expect(ctx.connections.list()).toHaveLength(2);
    expect(
      f.calls.some((call) => /api_keys|access_tokens|messages|chat\/completions/.test(call.url)),
    ).toBe(false);
  } finally {
    ctx.sqlite.close();
  }
});
test("Z.ai business renewal is saved before quota collection; transient failure keeps the old reading", async () => {
  const f = context(),
    { ctx } = f;
  try {
    const linked = await f.approve(),
      id = linked.connectionId;
    if (id === null) throw new Error("Expected connection");
    f.advance(3600000);
    f.token("synthetic-renewed-business-token");
    expect(await ctx.collection.run(id)).toMatchObject({ status: "collected" });
    expect(ctx.credentials.get(id)?.secret["accessToken"]).toBe("synthetic-renewed-business-token");
    expect(f.calls.findLast((call) => call.url.endsWith("/quota/limit"))?.authorization).toBe(
      "Bearer synthetic-renewed-business-token",
    );
    expect(f.calls.at(-1)?.authorization).toBe(`Bearer ${ready.data.token}`);
    expect(f.calls.at(-1)?.resetBusiness).toBe("synthetic-renewed-business-token");
    const snapshot = ctx.snapshots.latest(id)?.snapshot;
    f.advance(3600000);
    f.business(503);
    expect(await ctx.collection.run(id)).toMatchObject({ status: "failed" });
    expect(ctx.connections.get(id)?.state).toBe("ready");
    expect(ctx.snapshots.latest(id)?.snapshot).toEqual(snapshot);
    expect(ctx.credentials.get(id)?.secret["accessToken"]).toBe("synthetic-renewed-business-token");
    f.business(401);
    expect(await ctx.collection.run(id)).toMatchObject({ status: "failed" });
    expect(ctx.connections.get(id)?.state).toBe("reconnect_required");
  } finally {
    ctx.sqlite.close();
  }
});
test("a quota permission gap keeps the signed-in Z.ai account partial, while a rejected sign-in saves nothing", async () => {
  const f = context();
  try {
    f.business(401);
    expect(await f.approve()).toMatchObject({ state: "failed" });
    expect(f.ctx.connections.list()).toEqual([]);
    f.business(200);
    f.usage(403);
    const linked = await f.approve();
    expect(linked.state).toBe("succeeded");
    if (linked.connectionId === null) throw new Error("Expected partial connection");
    expect(f.ctx.connections.get(linked.connectionId)?.state).toBe("partial");
    expect(f.ctx.snapshots.latest(linked.connectionId)).toBeNull();
  } finally {
    f.ctx.sqlite.close();
  }
});

test("a reset-card rejection keeps Z.ai quota readable and does not discard its credentials", async () => {
  const f = context();
  try {
    const linked = await f.approve();
    const id = linked.connectionId;
    if (id === null) throw new Error("Expected connection");
    f.resets(401);
    expect(await f.ctx.collection.run(id)).toMatchObject({
      status: "collected",
      outcome: "partial",
    });
    expect(f.ctx.connections.get(id)?.state).toBe("partial");
    const reading = f.ctx.snapshots.latest(id);
    expect(reading?.metrics.find((m) => m.providerMetricKey === "quota.18000s")?.valueText).toBe(
      "25",
    );
    expect(
      reading?.metrics.find((m) => m.providerMetricKey === "reset_credits.available_count")
        ?.valueText,
    ).toBeNull();
    expect(f.ctx.credentials.get(id)?.secret["zcodeToken"]).toBe(ready.data.token);
    f.resets(200);
    expect(await f.ctx.collection.run(id)).toMatchObject({
      status: "collected",
      outcome: "succeeded",
    });
  } finally {
    f.ctx.sqlite.close();
  }
});
