import { expect, test } from "bun:test";
import { createKimiConnector } from "@headroom/connector-kimi";
import type { AttemptView } from "@headroom/core";
import usage from "../../../packages/connectors/kimi/src/fixtures/usage.json";
import device from "../../../packages/connectors/kimi/src/fixtures/device.json";
import token from "../../../packages/connectors/kimi/src/fixtures/token.json";
import { testContext } from "./test-helpers.ts";

function context() {
  let clock = 1_794_000_000_000;
  let accountId = "synthetic-owner";
  let accessToken = token.access_token;
  let refreshStatus = 200;
  let usageStatus = 200;
  const calls: { url: string; authorization: string | null }[] = [];
  const connector = createKimiConnector({
    now: () => clock,
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.endsWith("device_authorization")) return Promise.resolve(Response.json(device));
      if (url.endsWith("/token")) {
        const refresh =
          new URLSearchParams(typeof init?.body === "string" ? init.body : "").get("grant_type") ===
          "refresh_token";
        return Promise.resolve(
          Response.json(
            refresh && refreshStatus !== 200
              ? { error: "invalid_grant" }
              : { ...token, access_token: accessToken, refresh_token: `${accessToken}-refresh` },
            { status: refresh ? refreshStatus : 200 },
          ),
        );
      }
      if (url.endsWith("/me"))
        return Promise.resolve(
          Response.json({ user_id: accountId, nickname: "Sample Owner", user_level_name: "Plus" }),
        );
      if (url.endsWith("/usages"))
        return Promise.resolve(Response.json(usage, { status: usageStatus }));
      throw new Error("Unexpected synthetic request");
    },
  });
  const ctx = testContext({}, { connectors: [connector], now: () => new Date(clock) });
  async function approve(connectionId?: string): Promise<AttemptView> {
    let attempt = await ctx.connect.begin({
      provider: "kimi",
      method: "device_code",
      ...(connectionId === undefined ? {} : { connectionId }),
    });
    if (attempt.nextStep?.kind === "select_account")
      attempt = await ctx.connect.submit(attempt.id, { kind: "selection", id: "global" });
    expect(attempt.state).toBe("awaiting_user");
    expect(JSON.stringify(attempt)).not.toContain(device.device_code);
    clock += 5000;
    return ctx.connect.poll(attempt.id);
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
    token: (value: string) => {
      accessToken = value;
    },
    refresh: (status: number) => {
      refreshStatus = status;
    },
    usage: (status: number) => {
      usageStatus = status;
    },
  };
}

test("Kimi browser approval encrypts its session, keeps history on reconnect and refuses another account", async () => {
  const fixture = context();
  const { ctx } = fixture;
  try {
    const first = await fixture.approve();
    expect(first.state).toBe("succeeded");
    const id = first.connectionId;
    if (id === null) throw new Error("Expected connection");
    expect(ctx.connections.get(id)?.authMethod).toBe("device_code");
    expect(ctx.snapshots.latest(id)?.metrics).toHaveLength(2);
    expect(ctx.credentials.get(id)?.secret["accessToken"]).toBe(token.access_token);
    const sealed = ctx.sqlite
      .query<{ ciphertext: Buffer }, []>("SELECT ciphertext FROM credentials")
      .get();
    expect(sealed?.ciphertext.includes(Buffer.from(token.access_token))).toBe(false);
    expect(sealed?.ciphertext.includes(Buffer.from(`${token.access_token}-refresh`))).toBe(false);
    expect(JSON.stringify(first)).not.toContain(token.access_token);
    const snapshot = ctx.snapshots.latest(id)?.snapshot.id;
    fixture.token("synthetic-replacement-access");
    const reconnected = await fixture.approve(id);
    expect(reconnected.connectionId).toBe(id);
    expect(ctx.connections.list()).toHaveLength(1);
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
    fixture.account("synthetic-other-owner");
    const wrong = await fixture.approve(id);
    expect(wrong.state).toBe("failed");
    expect(wrong.error).toContain("identity_mismatch");
    expect(ctx.credentials.get(id)?.secret["accessToken"]).toBe("synthetic-replacement-access");
    expect(
      fixture.calls.every((c) => /\/(?:me|usages|token|device_authorization)$/.test(c.url)),
    ).toBe(true);
  } finally {
    ctx.sqlite.close();
  }
});

test("an existing Kimi key connection changes to one OAuth credential without losing its identity or history", async () => {
  const fixture = context();
  const { ctx } = fixture;
  try {
    const row = ctx.connections.create({
      provider: "kimi",
      identity: {
        providerAccountId: "global:synthetic-owner",
        workspaceId: null,
        label: "Sample",
        assurance: "strong",
      },
      scope: "individual",
      authMethod: "api_key",
      interface: "private",
      connectorVersion: "0.2.0",
    });
    const oldSession = `e30.${Buffer.from(JSON.stringify({ sub: "synthetic-owner" })).toString("base64url")}.c3ludGhldGlj`;
    ctx.credentials.put(
      row.id,
      {
        secret: { apiKey: "synthetic-legacy-key", region: "global", membershipToken: oldSession },
        expiresAt: null,
      },
      "not_refreshable",
    );
    await ctx.collection.run(row.id);
    const previous = ctx.snapshots.latest(row.id)?.snapshot.id;
    expect(previous).toBeDefined();
    const done = await fixture.approve(row.id);
    expect(done.state).toBe("succeeded");
    expect(done.connectionId).toBe(row.id);
    expect(ctx.connections.get(row.id)?.authMethod).toBe("device_code");
    const secret = ctx.credentials.get(row.id)?.secret;
    expect(secret?.["kind"]).toBe("oauth");
    expect(secret?.["apiKey"]).toBeUndefined();
    expect(secret?.["membershipToken"]).toBeUndefined();
    expect(
      ctx.sqlite
        .query<{ id: string }, [string]>("SELECT id FROM snapshots WHERE id = ?")
        .get(previous ?? ""),
    ).not.toBeNull();
  } finally {
    ctx.sqlite.close();
  }
});

test("Kimi OAuth refresh is persisted before collection, while revocation requires browser reconnect", async () => {
  const fixture = context();
  const { ctx } = fixture;
  try {
    const linked = await fixture.approve();
    const id = linked.connectionId;
    if (id === null) throw new Error("Expected connection");
    const deviceId = ctx.credentials.get(id)?.secret["deviceId"];
    fixture.advance(3600_000);
    fixture.token("synthetic-refreshed-access");
    expect(await ctx.collection.run(id)).toMatchObject({ status: "collected" });
    expect(ctx.credentials.get(id)?.secret["accessToken"]).toBe("synthetic-refreshed-access");
    expect(ctx.credentials.get(id)?.secret["deviceId"]).toBe(deviceId);
    expect(fixture.calls.at(-1)?.authorization).toBe("Bearer synthetic-refreshed-access");
    fixture.advance(3600_000);
    fixture.refresh(503);
    expect(await ctx.collection.run(id)).toMatchObject({ status: "failed" });
    expect(ctx.connections.get(id)?.state).toBe("ready");
    expect(ctx.credentials.get(id)?.secret["accessToken"]).toBe("synthetic-refreshed-access");
    fixture.refresh(400);
    await ctx.collection.run(id);
    expect(ctx.connections.get(id)?.state).toBe("reconnect_required");
  } finally {
    ctx.sqlite.close();
  }
});

test("Kimi quota permission failure keeps the browser identity partial without manufacturing a snapshot", async () => {
  const fixture = context();
  const { ctx } = fixture;
  fixture.usage(403);
  try {
    const done = await fixture.approve();
    expect(done.state).toBe("succeeded");
    if (done.connectionId === null) throw new Error("Expected partial connection");
    expect(ctx.connections.get(done.connectionId)?.state).toBe("partial");
    expect(ctx.snapshots.latest(done.connectionId)).toBeNull();
  } finally {
    ctx.sqlite.close();
  }
});
