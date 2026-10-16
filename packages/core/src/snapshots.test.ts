import { describe, expect, test } from "bun:test";

import { openDatabase, schema } from "./db/index.ts";
import { ConnectionStore } from "./lifecycle.ts";
import { okCollect } from "./services/fake-connector.ts";
import { SnapshotStore } from "./snapshots.ts";

const day = 86_400_000;
const base = 1_700_000_000_000;

function setup() {
  const { db, sqlite } = openDatabase({ path: ":memory:" });
  let now = base;
  const clock = () => new Date(now);
  const connections = new ConnectionStore(db, clock);
  const snapshots = new SnapshotStore(db, clock);
  const connect = (accountId: string) =>
    connections.create({
      provider: "codex",
      identity: {
        providerAccountId: accountId,
        workspaceId: null,
        label: "Fake",
        assurance: "strong",
      },
      scope: "individual",
      authMethod: "cli_login",
      interface: "private",
      connectorVersion: "fake-1",
    });
  /** One run and, unless `outcome` is a failure, its snapshot, both `daysAgo` days before `base`. */
  const collect = (
    connectionId: string,
    daysAgo: number,
    outcome: "succeeded" | "provider_unavailable" = "succeeded",
  ) => {
    now = base - daysAgo * day;
    const run = snapshots.startRun(connectionId);
    if (outcome === "provider_unavailable") {
      snapshots.finishRun(run.id, "provider_unavailable");
      return { run, snapshot: null };
    }
    const snapshot = snapshots.record(
      connectionId,
      run.id,
      { ...okCollect(), observedAt: now },
      "fake-1",
    );
    snapshots.finishRun(run.id, "succeeded");
    return { run, snapshot };
  };
  const tables = {
    snapshots: schema.snapshots,
    syncRuns: schema.syncRuns,
    metrics: schema.metrics,
    resetCredits: schema.resetCredits,
  };
  const count = (table: keyof typeof tables) => db.select().from(tables[table]).all().length;
  return { db, sqlite, snapshots, connect, collect, count, cutoff: new Date(base - 90 * day) };
}

describe("SnapshotStore.prune", () => {
  test("deletes history older than the cutoff and cascades metrics and reset credits", () => {
    const h = setup();
    const a = h.connect("a");
    h.collect(a.id, 200);
    h.collect(a.id, 100);
    const recent = h.collect(a.id, 10);
    h.collect(a.id, 0);
    expect(h.count("metrics")).toBe(4);

    expect(h.snapshots.prune(h.cutoff)).toEqual({ snapshots: 2, syncRuns: 2 });
    expect(h.count("snapshots")).toBe(2);
    expect(h.count("syncRuns")).toBe(2);
    expect(h.count("metrics")).toBe(2);
    expect(h.count("resetCredits")).toBe(2);
    expect(h.snapshots.history(a.id).some((row) => row.id === recent.snapshot?.id)).toBe(true);
    h.sqlite.close();
  });

  test("keeps each connection's newest snapshot and run however old", () => {
    const h = setup();
    const a = h.connect("a");
    const b = h.connect("b");
    h.collect(a.id, 400);
    const newestA = h.collect(a.id, 300);
    const newestB = h.collect(b.id, 500);

    expect(h.snapshots.prune(h.cutoff)).toEqual({ snapshots: 1, syncRuns: 1 });
    expect(h.snapshots.latest(a.id)?.snapshot.id).toBe(newestA.snapshot?.id);
    expect(h.snapshots.latest(b.id)?.snapshot.id).toBe(newestB.snapshot?.id);
    expect(h.snapshots.latest(b.id)?.metrics).toHaveLength(1);
    expect(h.snapshots.latestRun(a.id)?.id).toBe(newestA.run.id);
    expect(h.snapshots.prune(h.cutoff)).toEqual({ snapshots: 0, syncRuns: 0 });
    h.sqlite.close();
  });

  test("keeps the run that owns the newest snapshot when a later run failed", () => {
    const h = setup();
    const a = h.connect("a");
    const good = h.collect(a.id, 300);
    const failed = h.collect(a.id, 200, "provider_unavailable");

    expect(h.snapshots.prune(h.cutoff)).toEqual({ snapshots: 0, syncRuns: 0 });
    expect(h.snapshots.latestRun(a.id)?.id).toBe(failed.run.id);
    expect(h.snapshots.latest(a.id)?.snapshot.id).toBe(good.snapshot?.id);
    expect(h.count("metrics")).toBe(1);

    h.collect(a.id, 1);
    expect(h.snapshots.prune(h.cutoff)).toEqual({ snapshots: 1, syncRuns: 2 });
    h.sqlite.close();
  });

  test("clears an account action's snapshot link instead of failing the delete", () => {
    const h = setup();
    const a = h.connect("a");
    const old = h.collect(a.id, 200);
    const newest = h.collect(a.id, 1);
    const action = (id: string, snapshotId: string | null) =>
      h.db
        .insert(schema.accountActions)
        .values({
          id,
          connectionId: a.id,
          action: "consume_reset_credit",
          idempotencyKey: id,
          state: "succeeded",
          requestedAt: new Date(base),
          resultingSnapshotId: snapshotId,
        })
        .run();
    action("old", old.snapshot?.id ?? null);
    action("new", newest.snapshot?.id ?? null);

    expect(h.snapshots.prune(h.cutoff).snapshots).toBe(1);
    const rows = h.db.select().from(schema.accountActions).all();
    expect(rows.find((row) => row.id === "old")?.resultingSnapshotId).toBeNull();
    expect(rows.find((row) => row.id === "new")?.resultingSnapshotId).toBe(newest.snapshot?.id);
    h.sqlite.close();
  });

  test("does nothing on an empty database", () => {
    const h = setup();
    expect(h.snapshots.prune(h.cutoff)).toEqual({ snapshots: 0, syncRuns: 0 });
    h.sqlite.close();
  });
});

const weeklyReset = 1_700_604_800_000;

/**
 * Record a reading whose weekly metric has these times, or that leaves the metric out when `times` is
 * null, and return the stored instants of the weekly metric.
 */
function recordTimes(
  ctx: ReturnType<typeof setup>,
  connectionId: string,
  times: { resetsAt?: number | null; windowEnd?: number | null } | null,
  observedAt: number,
) {
  const result = okCollect();
  const [weekly] = result.metrics;
  if (weekly === undefined) throw new Error("okCollect has a weekly metric");
  const run = ctx.snapshots.startRun(connectionId);
  ctx.snapshots.record(
    connectionId,
    run.id,
    { ...result, observedAt, metrics: times === null ? [] : [{ ...weekly, ...times }] },
    "fake-1",
  );
  const stored = ctx.snapshots.latest(connectionId)?.metrics[0];
  return { resetsAt: stored?.resetsAt?.getTime(), windowEnd: stored?.windowEnd?.getTime() };
}

const recordReset = (
  ctx: ReturnType<typeof setup>,
  connectionId: string,
  resetsAt: number,
  observedAt: number,
) => recordTimes(ctx, connectionId, { resetsAt }, observedAt).resetsAt;

const minute = 60_000;

describe("SnapshotStore.record reset times", () => {
  test("keeps the previous reset time when the new one moved by under a second", () => {
    const ctx = setup();
    const id = ctx.connect("acct-1").id;
    expect(recordReset(ctx, id, weeklyReset - 488, base)).toBe(weeklyReset - 488);
    expect(recordReset(ctx, id, weeklyReset + 564, base + 600_000)).toBe(weeklyReset - 488);
    expect(recordReset(ctx, id, weeklyReset + 121, base + 1_200_000)).toBe(weeklyReset - 488);
  });

  test("keeps a time exactly two minutes away and takes one a millisecond further", () => {
    const ctx = setup();
    const id = ctx.connect("acct-1").id;
    recordReset(ctx, id, weeklyReset, base);
    expect(recordReset(ctx, id, weeklyReset + 2 * minute, base + 1)).toBe(weeklyReset);
    expect(recordReset(ctx, id, weeklyReset + 2 * minute + 1, base + 2)).toBe(
      weeklyReset + 2 * minute + 1,
    );
  });

  test("takes a new reset time that moved by more than two minutes", () => {
    const ctx = setup();
    const id = ctx.connect("acct-1").id;
    recordReset(ctx, id, weeklyReset, base);
    expect(recordReset(ctx, id, weeklyReset + 7 * day, base + 600_000)).toBe(weeklyReset + 7 * day);
  });

  test("steadies the window end the same way", () => {
    const ctx = setup();
    const id = ctx.connect("acct-1").id;
    const end = weeklyReset + day;
    expect(recordTimes(ctx, id, { windowEnd: end + 300 }, base).windowEnd).toBe(end + 300);
    expect(recordTimes(ctx, id, { windowEnd: end - 700 }, base + 600_000).windowEnd).toBe(
      end + 300,
    );
    expect(recordTimes(ctx, id, { windowEnd: end + 30 * day }, base + 1_200_000).windowEnd).toBe(
      end + 30 * day,
    );
  });

  test("keeps the last known time across a reading without the metric or without a time", () => {
    const ctx = setup();
    const id = ctx.connect("acct-1").id;
    recordReset(ctx, id, weeklyReset - 488, base);
    recordTimes(ctx, id, null, base + 600_000);
    expect(recordReset(ctx, id, weeklyReset + 564, base + 1_200_000)).toBe(weeklyReset - 488);
    expect(recordTimes(ctx, id, { resetsAt: null }, base + 1_800_000).resetsAt).toBeUndefined();
    expect(recordReset(ctx, id, weeklyReset + 121, base + 2_400_000)).toBe(weeklyReset - 488);
  });

  test("a value with no earlier time is stored as read", () => {
    const ctx = setup();
    const id = ctx.connect("acct-1").id;
    recordTimes(ctx, id, { resetsAt: null }, base);
    expect(recordReset(ctx, id, weeklyReset + 564, base + 600_000)).toBe(weeklyReset + 564);
  });

  test("does not carry a reset time to another connection", () => {
    const ctx = setup();
    recordReset(ctx, ctx.connect("acct-1").id, weeklyReset, base);
    expect(recordReset(ctx, ctx.connect("acct-2").id, weeklyReset + 500, base)).toBe(
      weeklyReset + 500,
    );
  });
});
