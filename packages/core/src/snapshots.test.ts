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
