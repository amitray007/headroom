import { describe, expect, test } from "bun:test";

import {
  credentialFixture,
  FakeConnector,
  okCollect,
  rateLimitError,
} from "@headroom/core/testing";

import { pruneEveryMs, Scheduler } from "./scheduler.ts";
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
    connect: ctx.connect,
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
      connect: ctx.connect,
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

  test("prunes on the first tick, then at most every six hours, with the current setting", async () => {
    const { ctx, advance } = setup();
    const cutoffs: number[] = [];
    ctx.snapshots.prune = (cutoff) => {
      cutoffs.push(cutoff.getTime());
      return { snapshots: 3, syncRuns: 2 };
    };
    let days = 90;
    const logs: string[] = [];
    const scheduler = new Scheduler({
      connections: ctx.connections,
      attempts: ctx.attempts,
      connect: ctx.connect,
      snapshots: ctx.snapshots,
      collection: ctx.collection,
      intervalMs: 900_000,
      retentionDays: () => days,
      now: ctx.now,
      log: (_level, message) => logs.push(message),
    });
    const start = ctx.now().getTime();
    await scheduler.tick();
    expect(cutoffs).toEqual([start - 90 * 86_400_000]);
    expect(logs).toContain("pruned history: 3 snapshots, 2 runs");
    advance(pruneEveryMs - 1);
    await scheduler.tick();
    expect(cutoffs).toHaveLength(1);
    days = 30;
    advance(1);
    await scheduler.tick();
    expect(cutoffs).toEqual([start - 90 * 86_400_000, start + pruneEveryMs - 30 * 86_400_000]);
  });

  test("a failing prune never breaks the tick and waits for the next window", async () => {
    const { ctx, connection } = setup();
    let calls = 0;
    ctx.snapshots.prune = () => {
      calls += 1;
      throw new Error("boom with https://example.com/secret");
    };
    const logs: string[] = [];
    const scheduler = new Scheduler({
      connections: ctx.connections,
      attempts: ctx.attempts,
      connect: ctx.connect,
      snapshots: ctx.snapshots,
      collection: ctx.collection,
      intervalMs: 900_000,
      retentionDays: () => 90,
      now: ctx.now,
      log: (_level, message) => logs.push(message),
    });
    expect(await scheduler.tick()).toEqual([connection.id]);
    await scheduler.tick();
    expect(calls).toBe(1);
    expect(logs.join("\n")).toContain("history prune failed: Error");
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
      connect: ctx.connect,
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

  test("expiring an overdue attempt asks the connector to clean up before the state changes", async () => {
    const { ctx, connector, scheduler, advance } = setup();
    const cancelled: unknown[] = [];
    connector.cancelConnect = () => {
      cancelled.push(ctx.attempts.get(attempt.id)?.state);
      return Promise.resolve();
    };
    const attempt = await ctx.connect.begin({ provider: "codex", method: "device_code" });
    advance(15 * 60_000 + 1);
    await scheduler.tick();
    expect(cancelled).toEqual(["awaiting_user"]);
    expect(ctx.attempts.get(attempt.id)?.state).toBe("expired");
    expect(ctx.attempts.privateState(attempt.id)).toBeNull();
  });

  test("one connection throwing does not stop the others, and afterTick still runs", async () => {
    const { ctx, connector, connection, advance } = setup();
    const second = ctx.connections.create({
      provider: "codex",
      identity: {
        providerAccountId: "acct-2",
        workspaceId: null,
        label: "Second",
        assurance: "strong",
      },
      scope: "individual",
      authMethod: "import",
      interface: "private",
      connectorVersion: "fake-1",
    });
    ctx.credentials.put(second.id, credentialFixture());
    // The first connection's credential cannot be read, as after a bad key or a corrupt row.
    ctx.sqlite.run("UPDATE credentials SET ciphertext = x'00' WHERE connection_id = ?", [
      connection.id,
    ]);
    const logs: string[] = [];
    let afterTicks = 0;
    const scheduler = new Scheduler({
      connections: ctx.connections,
      attempts: ctx.attempts,
      connect: ctx.connect,
      snapshots: ctx.snapshots,
      collection: ctx.collection,
      intervalMs: 900_000,
      now: ctx.now,
      afterTick: () => {
        afterTicks += 1;
      },
      log: (_level, message) => logs.push(message),
    });
    advance(1);
    expect(await scheduler.tick()).toEqual([second.id]);
    expect(connector.calls.filter((c) => c === "collect")).toHaveLength(1);
    expect(afterTicks).toBe(1);
    expect(logs.join("\n")).toContain(`collecting ${connection.id} failed:`);
  });

  test("an open run older than the lease is due again; a recent one is not", async () => {
    const { ctx, connection, scheduler, advance } = setup();
    ctx.snapshots.startRun(connection.id);
    expect(scheduler.isDue(connection.id)).toBe(false);
    advance(ctx.collection.leaseTtlMs - 1);
    expect(scheduler.isDue(connection.id)).toBe(false);
    advance(1);
    expect(scheduler.isDue(connection.id)).toBe(true);
    expect(await scheduler.tick()).toEqual([connection.id]);
  });

  test("stop resolves only after the tick in flight has finished", async () => {
    const { connector, scheduler } = setup();
    const started = gate();
    const finish = gate();
    connector.collect = () => {
      started.open();
      return finish.promise.then(() => okCollect());
    };
    const tick = scheduler.tick();
    await started.promise;
    const outcome = await Promise.race([
      scheduler.stop().then(() => "stopped"),
      Bun.sleep(20).then(() => "waiting"),
    ]);
    expect(outcome).toBe("waiting");
    finish.open();
    await scheduler.stop();
    expect(await tick).toHaveLength(1);
  });
});

/** A promise opened from outside, to hold a fake connector call until the test says so. */
function gate() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, open: resolve };
}
