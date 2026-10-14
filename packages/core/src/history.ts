import { sql } from "drizzle-orm";

import { AccountEventStore } from "./account-events.ts";
import type { AccountEvent } from "./automation-schemas.ts";
import type { Db } from "./db/index.ts";
import type { SyncRunOutcome } from "./enums.ts";

/**
 * Usage history for the Analytics view, read from stored snapshots. Only `quota_percentage` metrics
 * with a number: the same percent-of-limit readings the overview draws as meters. One scan reads the
 * readings and JS folds them into buckets and windows; coverage and failures are small SQL queries.
 */

export interface HistoryRange {
  from: number;
  to: number;
  bucketMs: number;
  /** Minutes east of UTC; buckets start on local boundaries. Default 0. */
  tzOffsetMinutes?: number;
  connectionIds: readonly string[];
}

interface HistorySeriesResult {
  providerMetricKey: string;
  scope: string;
  points: [number, number][];
  windows: { start: number | null; end: number }[];
}

export interface HistoryConnectionResult {
  id: string;
  coverage: { firstAt: number | null; lastAt: number | null; readings: number };
  series: HistorySeriesResult[];
  failures: { at: number; outcome: SyncRunOutcome }[];
  events: AccountEvent[];
}

/** Providers re-report a reset time with seconds of jitter; ends this close are one window. */
const sameWindowMs = 10 * 60_000;

interface CoverageRow {
  connection_id: string;
  first_at: number;
  last_at: number;
  readings: number;
}
interface FailureRow {
  connection_id: string;
  at: number;
  outcome: SyncRunOutcome;
}
type ReadingRow = [
  connection: string,
  key: string,
  scope: string,
  observedAt: number,
  value: number,
  start: number | null,
  end: number | null,
];
interface WindowReading {
  start: number | null;
  end: number;
  at: number;
}
interface SeriesAcc {
  providerMetricKey: string;
  scope: string;
  points: Map<number, number>;
  windows: Map<number, WindowReading>;
}

function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

/**
 * Oldest end first. A group opens at an anchor end and takes every end within `sameWindowMs` of
 * that anchor (not of the previous end, so a slow drift cannot chain forever). Each group keeps
 * the start and end of its latest reading, never a mix.
 */
function dedupeWindows(readings: Iterable<WindowReading>): HistorySeriesResult["windows"] {
  const sorted = [...readings].toSorted((a, b) => a.end - b.end);
  const out: WindowReading[] = [];
  let anchor = Number.NEGATIVE_INFINITY;
  for (const row of sorted) {
    if (row.end - anchor <= sameWindowMs) {
      const last = out.length - 1;
      if (row.at >= out[last]!.at) out[last] = row;
    } else {
      anchor = row.end;
      out.push(row);
    }
  }
  return out.map(({ start, end }) => ({ start, end }));
}

/**
 * Cheap change marker for the history of these accounts: the newest snapshot, sync run and event
 * time. Each is a correlated MAX on an index, so it stays fast however much history is stored.
 */
export function historyMarker(db: Db, connectionIds: readonly string[]): string {
  if (connectionIds.length === 0) return "";
  const row = db.values<[number | null, number | null, number | null]>(sql`
    SELECT
      MAX((SELECT MAX(observed_at) FROM snapshots WHERE connection_id = c.id)),
      MAX((SELECT MAX(started_at) FROM sync_runs WHERE connection_id = c.id)),
      MAX((SELECT MAX(occurred_at) FROM account_events WHERE connection_id = c.id))
    FROM connections c WHERE c.id IN (${idList(connectionIds)})`)[0];
  return (row ?? []).join(":");
}

export function readHistory(db: Db, range: HistoryRange): HistoryConnectionResult[] {
  const { from, to, bucketMs, connectionIds } = range;
  if (connectionIds.length === 0) return [];
  const ids = idList(connectionIds);
  const shift = (range.tzOffsetMinutes ?? 0) * 60_000;

  // One ungrouped scan; the folding below is cheaper than two grouped queries.
  const rows = db.values<ReadingRow>(sql`
    SELECT s.connection_id, m.provider_metric_key, m.scope, s.observed_at, m.value_num,
      m.window_start, COALESCE(m.window_end, m.resets_at)
    FROM snapshots s JOIN metrics m ON m.snapshot_id = s.id
    WHERE s.connection_id IN (${ids}) AND s.observed_at BETWEEN ${from} AND ${to}
      AND m.kind = 'quota_percentage' AND m.availability = 'available' AND m.value_num IS NOT NULL`);
  const byConnection = new Map<string, Map<string, SeriesAcc>>();
  for (const [connection, key, scope, at, value, start, end] of rows) {
    let all = byConnection.get(connection);
    if (!all) byConnection.set(connection, (all = new Map()));
    const mapKey = `${key}\u0000${scope}`;
    let acc = all.get(mapKey);
    if (!acc) {
      acc = { providerMetricKey: key, scope, points: new Map(), windows: new Map() };
      all.set(mapKey, acc);
    }
    const bucket = Math.floor((at + shift) / bucketMs) * bucketMs - shift;
    const seen = acc.points.get(bucket);
    if (seen === undefined || value > seen) acc.points.set(bucket, value);
    if (end !== null) {
      const slot = Math.floor(end / sameWindowMs);
      const held = acc.windows.get(slot);
      if (!held || at >= held.at) acc.windows.set(slot, { start, end, at });
    }
  }

  const coverage = new Map(
    db
      .all<CoverageRow>(
        sql`SELECT connection_id, MIN(observed_at) AS first_at, MAX(observed_at) AS last_at, COUNT(*) AS readings
          FROM snapshots WHERE connection_id IN (${ids}) AND observed_at BETWEEN ${from} AND ${to}
          GROUP BY connection_id`,
      )
      .map((row) => [row.connection_id, row]),
  );
  const failuresBy = new Map<string, { at: number; outcome: SyncRunOutcome }[]>();
  for (const row of db.all<FailureRow>(sql`
    SELECT connection_id, started_at AS at, outcome FROM sync_runs
    WHERE connection_id IN (${ids}) AND started_at BETWEEN ${from} AND ${to}
      AND outcome IS NOT NULL AND outcome NOT IN ('succeeded', 'partial')
    ORDER BY started_at ASC`)) {
    const list = failuresBy.get(row.connection_id) ?? [];
    list.push({ at: row.at, outcome: row.outcome });
    failuresBy.set(row.connection_id, list);
  }
  const eventsBy = new Map<string, AccountEvent[]>();
  for (const event of new AccountEventStore(db).between(from, to, connectionIds)) {
    const list = eventsBy.get(event.connectionId) ?? [];
    list.push(event);
    eventsBy.set(event.connectionId, list);
  }

  return connectionIds.map((id) => {
    const seen = coverage.get(id);
    return {
      id,
      coverage: {
        firstAt: seen?.first_at ?? null,
        lastAt: seen?.last_at ?? null,
        readings: seen?.readings ?? 0,
      },
      series: [...(byConnection.get(id)?.values() ?? [])].map((acc) => ({
        providerMetricKey: acc.providerMetricKey,
        scope: acc.scope,
        points: [...acc.points].toSorted((a, b) => a[0] - b[0]),
        windows: dedupeWindows(acc.windows.values()),
      })),
      failures: failuresBy.get(id) ?? [],
      events: eventsBy.get(id) ?? [],
    };
  });
}
