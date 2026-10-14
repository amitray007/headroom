import { describe, expect, test } from "bun:test";

import { AccountEventStore } from "./account-events.ts";
import type { CollectResult } from "./connector.ts";
import { openDatabase } from "./db/index.ts";
import type { SyncRunOutcome } from "./enums.ts";
import { historyMarker, readHistory } from "./history.ts";
import { ConnectionStore } from "./lifecycle.ts";
import { SnapshotStore } from "./snapshots.ts";

const hour = 3_600_000;
const minute = 60_000;
const t0 = 1_700_000_000_000 - (1_700_000_000_000 % hour); // an hour boundary
const bucketMs = hour;

function setup() {
  const { db } = openDatabase({ path: ":memory:" });
  let now = t0;
  const clock = () => new Date(now);
  const connections = new ConnectionStore(db, clock);
  const snapshots = new SnapshotStore(db, clock);
  const connect = (id: string) =>
    connections.create({
      provider: "codex",
      identity: { providerAccountId: id, workspaceId: null, label: "Fake", assurance: "strong" },
      scope: "individual",
      authMethod: "cli_login",
      interface: "private",
      connectorVersion: "fake-1",
    });
  type Reading = Partial<CollectResult["metrics"][number]> & { value?: string | null };
  /** One finished run and its snapshot at `at`, with one metric per reading. */
  const read = (connectionId: string, at: number, ...readings: Reading[]) => {
    now = at;
    const run = snapshots.startRun(connectionId);
    snapshots.record(
      connectionId,
      run.id,
      {
        observedAt: at,
        metrics: readings.map(({ value, ...rest }) =>
          Object.assign(
            {
              providerMetricKey: "five_hour",
              kind: "quota_percentage" as const,
              scope: "account",
              valueText: value === undefined ? "10" : value,
              unit: "percent",
              availability: "available" as const,
              interface: "private" as const,
            },
            rest,
          ),
        ),
        resetCredits: [],
        failures: [],
      },
      "fake-1",
    );
    snapshots.finishRun(run.id, "succeeded");
  };
  const fail = (connectionId: string, at: number, outcome: SyncRunOutcome) => {
    now = at;
    snapshots.finishRun(snapshots.startRun(connectionId).id, outcome);
  };
  const query = (ids: string[], from = t0 - 10 * hour, to = t0 + 10 * hour) =>
    readHistory(db, { from, to, bucketMs, connectionIds: ids });
  return { db, connect, read, fail, query, events: new AccountEventStore(db, clock) };
}

describe("readHistory", () => {
  test("takes the highest reading of each hour, oldest hour first", () => {
    const h = setup();
    const a = h.connect("a");
    h.read(a.id, t0 + hour + 5 * minute, { value: "30" });
    h.read(a.id, t0 + 10 * minute, { value: "10" });
    h.read(a.id, t0 + 20 * minute, { value: "25" });
    h.read(a.id, t0 + 50 * minute, { value: "20" });
    const [result] = h.query([a.id]);
    expect(result?.series).toEqual([
      {
        providerMetricKey: "five_hour",
        scope: "account",
        points: [
          [t0, 25],
          [t0 + hour, 30],
        ],
        windows: [],
      },
    ]);
    expect(result?.coverage).toEqual({
      firstAt: t0 + 10 * minute,
      lastAt: t0 + hour + 5 * minute,
      readings: 4,
    });
  });

  test("skips null, unavailable and non-percentage metrics", () => {
    const h = setup();
    const a = h.connect("a");
    h.read(
      a.id,
      t0,
      { value: null },
      { providerMetricKey: "gone", availability: "unsupported" },
      { providerMetricKey: "money", kind: "spend", unit: "usd", value: "5" },
    );
    expect(h.query([a.id])[0]?.series).toEqual([]);
  });

  test("merges window ends within ten minutes and keeps the latest reading's", () => {
    const h = setup();
    const a = h.connect("a");
    const end = t0 + 5 * hour;
    h.read(a.id, t0, { resetsAt: end });
    h.read(a.id, t0 + hour, { resetsAt: end + 4_000 });
    h.read(a.id, t0 + 2 * hour, { resetsAt: end + 5 * hour });
    h.read(a.id, t0 + 3 * hour, { windowStart: end + hour, windowEnd: end + 11 * hour });
    expect(h.query([a.id])[0]?.series[0]?.windows).toEqual([
      { start: null, end: end + 4_000 },
      { start: null, end: end + 5 * hour },
      { start: end + hour, end: end + 11 * hour },
    ]);
  });

  test("lists failed runs but not succeeded or partial ones", () => {
    const h = setup();
    const a = h.connect("a");
    h.fail(a.id, t0 + 2 * hour, "rate_limited");
    h.fail(a.id, t0 + hour, "authentication_failed");
    h.fail(a.id, t0, "partial");
    h.read(a.id, t0 + 3 * hour);
    expect(h.query([a.id])[0]?.failures).toEqual([
      { at: t0 + hour, outcome: "authentication_failed" },
      { at: t0 + 2 * hour, outcome: "rate_limited" },
    ]);
  });

  test("returns events in range, oldest first, for the requested account only", () => {
    const h = setup();
    const a = h.connect("a");
    const b = h.connect("b");
    const detail = {
      kind: "early_reset",
      previousPercent: 60,
      percent: 2,
      expectedResetAt: t0 + 30 * hour,
    } as const;
    h.events.record(a.id, t0 + 2 * hour, "weekly", detail);
    h.events.record(a.id, t0 + hour, "weekly", detail);
    h.events.record(a.id, t0 + 20 * hour, "weekly", detail);
    h.events.record(b.id, t0 + hour, "weekly", detail);
    const events = h.query([a.id])[0]?.events;
    expect(events?.map((event) => event.occurredAt)).toEqual([t0 + hour, t0 + 2 * hour]);
  });

  test("an account with no readings has null coverage and empty lists", () => {
    const h = setup();
    const a = h.connect("a");
    expect(h.query([a.id])).toEqual([
      {
        id: a.id,
        coverage: { firstAt: null, lastAt: null, readings: 0 },
        series: [],
        failures: [],
        events: [],
      },
    ]);
    expect(h.query([])).toEqual([]);
  });

  test("buckets on local hours for a time zone offset", () => {
    const h = setup();
    const a = h.connect("a");
    h.read(a.id, t0 + 40 * minute, { value: "30" }); // UTC xx:40 is local xx+1:10 at +5:30
    const [result] = readHistory(h.db, {
      from: t0 - 10 * hour,
      to: t0 + 10 * hour,
      bucketMs,
      tzOffsetMinutes: 330,
      connectionIds: [a.id],
    });
    expect(result?.series[0]?.points).toEqual([[t0 + 30 * minute, 30]]);
  });

  test("a slowly drifting end cannot chain windows together", () => {
    const h = setup();
    const a = h.connect("a");
    for (let i = 0; i < 6; i++)
      h.read(a.id, t0 + i * minute, { resetsAt: t0 + 20 * hour + i * 4 * minute });
    const windows = h.query([a.id])[0]?.series[0]?.windows ?? [];
    expect(windows.length).toBeGreaterThan(1);
  });

  test("jittered ends within one window collapse to the latest reading's", () => {
    const h = setup();
    const a = h.connect("a");
    for (let i = 0; i < 50; i++)
      h.read(a.id, t0 + i * minute, { resetsAt: t0 + 20 * hour + i * 1_000 });
    expect(h.query([a.id])[0]?.series[0]?.windows).toEqual([
      { start: null, end: t0 + 20 * hour + 49_000 },
    ]);
  });

  test("marks a change when a snapshot, run or event is added", () => {
    const h = setup();
    const a = h.connect("a");
    const before = historyMarker(h.db, [a.id]);
    h.read(a.id, t0 + hour);
    const after = historyMarker(h.db, [a.id]);
    expect(after).not.toBe(before);
    expect(historyMarker(h.db, [])).toBe("");
  });
});
