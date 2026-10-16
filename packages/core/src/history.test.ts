import { describe, expect, test } from "bun:test";

import { AccountEventStore } from "./account-events.ts";
import type { CollectResult } from "./connector.ts";
import { openDatabase } from "./db/index.ts";
import type { SyncRunOutcome } from "./enums.ts";
import {
  createHistoryReader,
  historyMarker,
  readHistory,
  type HistoryRange,
  type HistoryReader,
} from "./history.ts";
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
  return { db, connect, read, fail, query, snapshots, events: new AccountEventStore(db, clock) };
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
    // Past the store's 2-minute steadying, so the stored ends differ and history merges them.
    h.read(a.id, t0 + hour, { resetsAt: end + 4 * minute });
    h.read(a.id, t0 + 2 * hour, { resetsAt: end + 5 * hour });
    h.read(a.id, t0 + 3 * hour, { windowStart: end + hour, windowEnd: end + 11 * hour });
    expect(h.query([a.id])[0]?.series[0]?.windows).toEqual([
      { start: null, end: end + 4 * minute },
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

  test("second-level jitter in one window is stored as one steady end", () => {
    const h = setup();
    const a = h.connect("a");
    for (let i = 0; i < 50; i++)
      h.read(a.id, t0 + i * minute, { resetsAt: t0 + 20 * hour + i * 1_000 });
    expect(h.query([a.id])[0]?.series[0]?.windows).toEqual([{ start: null, end: t0 + 20 * hour }]);
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

  test("marks a change when a run in flight finishes as failed", () => {
    const h = setup();
    const a = h.connect("a");
    const run = h.snapshots.startRun(a.id);
    const before = historyMarker(h.db, [a.id]);
    h.snapshots.finishRun(run.id, "provider_unavailable");
    expect(historyMarker(h.db, [a.id])).not.toBe(before);
  });
});

/** A kept reader and a fresh read of the same range must agree. */
function same(h: ReturnType<typeof setup>, reader: HistoryReader, range: HistoryRange) {
  expect(reader.read(h.db, range)).toEqual(readHistory(h.db, range));
}

describe("createHistoryReader", () => {
  const day = 24 * hour;

  test("folds only new readings and still matches a fresh read", () => {
    const h = setup();
    const a = h.connect("a");
    const b = h.connect("b");
    const reader = createHistoryReader({ keepMs: 2 * day });
    for (let i = 0; i < 30; i++) {
      h.read(a.id, t0 + i * 20 * minute, { value: String(i), resetsAt: t0 + 5 * hour });
      h.read(b.id, t0 + i * 20 * minute + minute, {
        providerMetricKey: "weekly",
        value: String(30 - i),
      });
    }
    const range = (to: number): HistoryRange => ({
      from: to - day,
      to,
      bucketMs,
      connectionIds: [a.id, b.id],
    });
    same(h, reader, range(t0 + 10 * hour));
    h.read(a.id, t0 + 10 * hour + 5 * minute, { value: "99", resetsAt: t0 + 5 * hour + 3_000 });
    // A late insert, observed a little before the newest reading already folded.
    h.read(b.id, t0 + 9 * hour + 30 * minute, { providerMetricKey: "weekly", value: "77" });
    same(h, reader, range(t0 + 11 * hour));
    // A provider-cached reading stored late, observed hours before the newest one folded.
    h.read(a.id, t0 + 2 * hour, { value: "95", resetsAt: t0 + 5 * hour });
    same(h, reader, range(t0 + 11 * hour));
  });

  test("a reading observed after the range end is folded once the range reaches it", () => {
    const h = setup();
    const a = h.connect("a");
    const reader = createHistoryReader({ keepMs: 2 * day });
    h.read(a.id, t0 + hour, { value: "10" });
    const range = (to: number): HistoryRange => ({
      from: to - day,
      to,
      bucketMs,
      connectionIds: [a.id],
    });
    same(h, reader, range(t0 + 2 * hour));
    h.read(a.id, t0 + 3 * hour, { value: "60" });
    h.read(a.id, t0 + 2 * hour - minute, { value: "30" });
    same(h, reader, range(t0 + 2 * hour));
    same(h, reader, range(t0 + 4 * hour));
    expect(reader.read(h.db, range(t0 + 4 * hour))[0]?.series[0]?.points.at(-1)).toEqual([
      t0 + 3 * hour,
      60,
    ]);
  });

  test("the first hour of a moved range counts only readings inside it", () => {
    const h = setup();
    const a = h.connect("a");
    const reader = createHistoryReader({ keepMs: 3 * day });
    h.read(a.id, t0 + 5 * minute, { value: "90", resetsAt: t0 + hour });
    h.read(a.id, t0 + 40 * minute, { value: "20", resetsAt: t0 + 6 * hour });
    h.read(a.id, t0 + 3 * hour, { value: "30", resetsAt: t0 + 6 * hour });
    const ids = [a.id];
    same(h, reader, { from: t0 - hour, to: t0 + 4 * hour, bucketMs, connectionIds: ids });
    // The range now starts at xx:30: the 90 at xx:05 and its window are out, the 20 at xx:40 is in.
    const moved = { from: t0 + 30 * minute, to: t0 + 4 * hour, bucketMs, connectionIds: ids };
    same(h, reader, moved);
    expect(reader.read(h.db, moved)[0]?.series[0]?.points[0]).toEqual([t0, 20]);
  });

  test("a pruned reading does not show", () => {
    const h = setup();
    const a = h.connect("a");
    const reader = createHistoryReader({ keepMs: 3 * day });
    h.read(a.id, t0 + 10 * minute, { value: "80" });
    h.read(a.id, t0 + 50 * minute, { value: "10" });
    h.read(a.id, t0 + 5 * hour, { value: "40" });
    const range = { from: t0 - day, to: t0 + 6 * hour, bucketMs, connectionIds: [a.id] };
    same(h, reader, range);
    h.snapshots.prune(new Date(t0 + 30 * minute));
    same(h, reader, range);
    expect(reader.read(h.db, range)[0]?.series[0]?.points[0]).toEqual([t0, 10]);
  });

  test("a new account or time zone reads in full", () => {
    const h = setup();
    const a = h.connect("a");
    const reader = createHistoryReader({ keepMs: 3 * day });
    h.read(a.id, t0 + 10 * minute, { value: "15" });
    const range = { from: t0 - day, to: t0 + 6 * hour, bucketMs, connectionIds: [a.id] };
    same(h, reader, range);
    const b = h.connect("b");
    h.read(b.id, t0 + 20 * minute, { value: "25" });
    same(h, reader, { ...range, connectionIds: [a.id, b.id] });
    same(h, reader, { ...range, connectionIds: [b.id] });
    same(h, reader, { ...range, tzOffsetMinutes: 330 });
  });
});
