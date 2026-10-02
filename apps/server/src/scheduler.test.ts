import { describe, expect, test } from "bun:test";

import { credentialFixture, FakeConnector, rateLimitError } from "@headroom/core/testing";

import { Scheduler } from "./scheduler.ts";
import { testContext } from "./test-helpers.ts";

function setup() {
  let now = 1_700_000_000_000;
  const connector = new FakeConnector("codex");
  const ctx = testContext({}, { connectors: [connector], now: () => new Date(now) });
  const connection = ctx.connections.create({
    provider: "codex",
    identity: {
      providerAccountId: "acct-1",
      workspaceId: null,
      label: "Fake",
      assurance: "strong",
    },
    scope: "individual",
    authMethod: "import",
    interface: "private",
    connectorVersion: "fake-1",
  });
  ctx.credentials.put(connection.id, credentialFixture());
  const scheduler = new Scheduler({
    connections: ctx.connections,
    attempts: ctx.attempts,
    snapshots: ctx.snapshots,
    collection: ctx.collection,
    intervalMs: 900_000,
    now: () => new Date(now),
  });
  return { ctx, connector, connection, scheduler, advance: (ms: number) => (now += ms) };
}

describe("Scheduler", () => {
  test("afterTick runs after each tick, and its failure never breaks the scheduler", async () => {
    const { ctx, scheduler: _unused, connection, advance } = setup();
    const seen: number[] = [];
    let fail = false;
    const logs: string[] = [];
    const scheduler = new Scheduler({
      connections: ctx.connections,
      attempts: ctx.attempts,
      snapshots: ctx.snapshots,
      collection: ctx.collection,
      intervalMs: 900_000,
      now: ctx.now,
      afterTick: (now) => {
        seen.push(now);
        if (fail) throw new Error("boom with https://example.com/secret");
      },
      log: (_level, message) => logs.push(message),
    });
    expect(await scheduler.tick()).toEqual([connection.id]);
    expect(seen).toHaveLength(1);
    fail = true;
    advance(1);
    expect(await scheduler.tick()).toEqual([]);
    expect(seen).toHaveLength(2);
    expect(logs.join("\n")).toContain("after-tick hook failed: Error");
    expect(logs.join("\n")).not.toContain("secret");
  });

  test("collects a connection with no run, then waits for the interval", async () => {
    const { connector, connection, scheduler, advance } = setup();
    expect(await scheduler.tick()).toEqual([connection.id]);
    expect(await scheduler.tick()).toEqual([]);
    advance(900_000 + 90_000 + 1);
    expect(await scheduler.tick()).toEqual([connection.id]);
    expect(connector.calls.filter((c) => c === "collect")).toHaveLength(2);
  });

  test("the interval follows a getter, so a settings change applies at the next tick", async () => {
    const { ctx, connector, connection, advance } = setup();
    const scheduler = new Scheduler({
      connections: ctx.connections,
      attempts: ctx.attempts,
      snapshots: ctx.snapshots,
      collection: ctx.collection,
      intervalMs: () => ctx.settings.get().refreshIntervalMinutes * 60_000,
      now: ctx.now,
    });
    expect(await scheduler.tick()).toEqual([connection.id]);
    ctx.settings.put({ ...ctx.settings.get(), refreshIntervalMinutes: 30 });
    advance(20 * 60_000);
    expect(await scheduler.tick()).toEqual([]);
    ctx.settings.put({ ...ctx.settings.get(), refreshIntervalMinutes: 5 });
    expect(await scheduler.tick()).toEqual([connection.id]);
    expect(connector.calls.filter((c) => c === "collect")).toHaveLength(2);
  });

  test("honours Retry-After and skips paused connections", async () => {
    const { ctx, connector, connection, scheduler, advance } = setup();
    connector.collectQueue.push(rateLimitError());
    expect(await scheduler.tick()).toEqual([connection.id]);
    advance(10_000);
    expect(await scheduler.tick()).toEqual([]);
    advance(20_001);
    expect(await scheduler.tick()).toEqual([connection.id]);
    ctx.connections.setPaused(connection.id, true);
    advance(2_000_000);
    expect(await scheduler.tick()).toEqual([]);
  });

  test("expires overdue attempts on every tick", async () => {
    const { ctx, scheduler, advance } = setup();
    const attempt = ctx.attempts.create({ provider: "codex", method: "device_code", ttlMs: 1_000 });
    advance(2_000);
    await scheduler.tick();
    expect(ctx.attempts.get(attempt.id)?.state).toBe("expired");
  });
});
