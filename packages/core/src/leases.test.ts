import { describe, expect, test } from "bun:test";

import { openDatabase, schema } from "./db/index.ts";
import { LeaseHeldError, LeaseStore } from "./leases.ts";

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

function setup() {
  const { db } = openDatabase({ path: ":memory:" });
  db.insert(schema.connections)
    .values({
      id: "c1",
      provider: "codex",
      providerAccountId: "acct",
      scope: "individual",
      label: "c1",
      authMethod: "cli_login",
      state: "ready",
      interface: "private",
      connectorVersion: "0.0.0",
    })
    .run();
  let now = 1_000_000;
  const clock = { now: () => new Date(now), advance: (ms: number) => (now += ms) };
  return { leases: new LeaseStore(db, clock.now), clock };
}

describe("LeaseStore", () => {
  test("second holder cannot acquire a live lease; same holder can re-acquire", () => {
    const { leases } = setup();
    expect(leases.acquire("c1", "a", 10_000)).toBe(true);
    expect(leases.acquire("c1", "b", 10_000)).toBe(false);
    expect(leases.acquire("c1", "a", 10_000)).toBe(true);
  });

  test("an expired lease can be taken over", () => {
    const { leases, clock } = setup();
    expect(leases.acquire("c1", "a", 10_000)).toBe(true);
    clock.advance(10_001);
    expect(leases.acquire("c1", "b", 10_000)).toBe(true);
    expect(leases.renew("c1", "a", 10_000)).toBe(false);
    expect(leases.renew("c1", "b", 10_000)).toBe(true);
  });

  test("release frees the lease and withLease always releases", async () => {
    const { leases } = setup();
    const result = await leases.withLease("c1", "a", 10_000, async () => {
      expect(leases.acquire("c1", "b", 10_000)).toBe(false);
      const nested = await rejection(
        leases.withLease("c1", "b", 10_000, () => Promise.resolve("never")),
      );
      expect(nested).toBeInstanceOf(LeaseHeldError);
      return "done";
    });
    expect(result).toBe("done");
    expect(leases.acquire("c1", "b", 10_000)).toBe(true);
  });

  test("acquireWithin waits for the holder to release, and gives up after the wait", async () => {
    const { leases } = setup();
    expect(leases.acquire("c1", "a", 60_000)).toBe(true);
    expect(await leases.acquireWithin("c1", "b", 10_000, 30, 5)).toBe(false);
    setTimeout(() => leases.release("c1", "a"), 20);
    expect(await leases.acquireWithin("c1", "b", 10_000, 1_000, 5)).toBe(true);
    expect(leases.acquire("c1", "c", 10_000)).toBe(false);
  });
});
