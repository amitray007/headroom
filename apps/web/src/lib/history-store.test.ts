import { describe, expect, test } from "bun:test";

import type { History } from "@headroom/view-model/history";

import { createHistoryStore, idsOf } from "./history-store.ts";

function historyOf(ids: readonly string[]): History {
  return {
    from: 0,
    to: 1,
    bucketMs: 3_600_000,
    retentionDays: 90,
    connections: ids.map((id) => ({
      id,
      coverage: { firstAt: null, lastAt: null, readings: 0 },
      series: [],
      failures: [],
      events: [],
    })),
  };
}

function client(results: (() => Promise<History>)[]) {
  let calls = 0;
  return {
    calls: () => calls,
    history: () => {
      calls += 1;
      const result = results.shift();
      return result ? result() : Promise.reject(new Error("unexpected"));
    },
  };
}

/** A fake interval: the test runs each tick by hand. */
function timers() {
  const runs: (() => void)[] = [];
  return {
    runs,
    every: (run: () => void) => {
      runs.push(run);
      return () => {
        runs.splice(runs.indexOf(run), 1);
      };
    },
  };
}

const settle = () => Bun.sleep(0);

describe("history store", () => {
  test("reads once, and a second ensure while it is fresh does not read again", async () => {
    const c = client([() => Promise.resolve(historyOf(["b", "a"]))]);
    let clock = 1_000;
    const store = createHistoryStore(c, {
      now: () => clock,
      visibility: null,
      every: timers().every,
    });
    expect(store.getState().history).toBeNull();
    store.ensure(null);
    store.ensure(null);
    await settle();
    expect(c.calls()).toBe(1);
    expect(store.getState().history?.connections).toHaveLength(2);
    expect(store.getState().fetchedAt).toBe(1_000);
    clock += 60_000;
    store.ensure("a,b");
    expect(c.calls()).toBe(1);
  });

  test("reads again when the held history is stale or covers other accounts", async () => {
    const c = client([
      () => Promise.resolve(historyOf(["a"])),
      () => Promise.resolve(historyOf(["a", "b"])),
      () => Promise.resolve(historyOf(["a", "b"])),
    ]);
    let clock = 0;
    const store = createHistoryStore(c, {
      now: () => clock,
      visibility: null,
      every: timers().every,
    });
    store.ensure("a");
    await settle();
    store.ensure("a,b");
    await settle();
    expect(c.calls()).toBe(2);
    expect(idsOf(store.getState().history!)).toBe("a,b");
    clock += 5 * 60_000 + 1;
    store.ensure("a,b");
    await settle();
    expect(c.calls()).toBe(3);
  });

  test("a failed read keeps the history already shown and marks it", async () => {
    const c = client([
      () => Promise.resolve(historyOf(["a"])),
      () => Promise.reject(new Error("down")),
    ]);
    const store = createHistoryStore(c, { visibility: null, every: timers().every });
    await store.reload();
    await store.reload();
    expect(store.getState().failed).toBe(true);
    expect(store.getState().history?.connections[0]?.id).toBe("a");
  });

  test("polls only while someone listens", async () => {
    const t = timers();
    const c = client([() => Promise.resolve(historyOf(["a"]))]);
    const store = createHistoryStore(c, { visibility: null, every: t.every });
    const stop = store.subscribe(() => undefined);
    expect(t.runs).toHaveLength(1);
    expect(c.calls()).toBe(0);
    t.runs[0]!();
    await settle();
    expect(c.calls()).toBe(1);
    stop();
    expect(t.runs).toHaveLength(0);
    expect(store.getState().history).not.toBeNull();
  });
});
