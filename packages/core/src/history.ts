import { sql } from "drizzle-orm";

import { AccountEventStore } from "./account-events.ts";
import type { AccountEvent } from "./automation-schemas.ts";
import type { Db } from "./db/index.ts";
import type { SyncRunOutcome } from "./enums.ts";

/**
 * Usage history for the Analytics view, read from stored snapshots. Only `quota_percentage` metrics
 * with a number: the same percent-of-limit readings the overview draws as meters. Bucketing, the
 * window list, coverage and failures are done in SQL, so a long range stays small.
 */

export interface HistoryRange {
  from: number;
  to: number;
  bucketMs: number;
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

interface PointRow {
  connection_id: string;
  key: string;
  scope: string;
  bucket: number;
  value: number;
}
interface WindowRow {
  connection_id: string;
  key: string;
  scope: string;
  start: number | null;
  end: number | null;
  last_at: number;
}
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

function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

/** Oldest first; ends within `sameWindowMs` of the previous one merge, keeping the latest reading's values. */
function dedupeWindows(rows: readonly WindowRow[]): HistorySeriesResult["windows"] {
  const sorted = rows
    .flatMap((row) =>
      row.end === null ? [] : [{ start: row.start, end: row.end, at: row.last_at }],
    )
    .toSorted((a, b) => a.end - b.end);
  const merged: { start: number | null; end: number; at: number }[] = [];
  for (const row of sorted) {
    const last = merged.at(-1);
    if (last && row.end - last.end <= sameWindowMs) {
      if (row.at >= last.at) merged[merged.length - 1] = row;
      else last.end = Math.max(last.end, row.end);
    } else merged.push(row);
  }
  return merged.map(({ start, end }) => ({ start, end }));
}

export function readHistory(db: Db, range: HistoryRange): HistoryConnectionResult[] {
  const { from, to, bucketMs, connectionIds } = range;
  if (connectionIds.length === 0) return [];
  const ids = idList(connectionIds);
  const readings = sql`s.connection_id IN (${ids}) AND s.observed_at BETWEEN ${from} AND ${to}
    AND m.kind = 'quota_percentage' AND m.availability = 'available' AND m.value_num IS NOT NULL`;

  const points = db.all<PointRow>(sql`
    SELECT s.connection_id, m.provider_metric_key AS key, m.scope,
      CAST(s.observed_at / ${bucketMs} AS INTEGER) * ${bucketMs} AS bucket, MAX(m.value_num) AS value
    FROM snapshots s JOIN metrics m ON m.snapshot_id = s.id
    WHERE ${readings}
    GROUP BY s.connection_id, m.provider_metric_key, m.scope, bucket
    ORDER BY bucket ASC`);
  const windows = db.all<WindowRow>(sql`
    SELECT s.connection_id, m.provider_metric_key AS key, m.scope, m.window_start AS start,
      COALESCE(m.window_end, m.resets_at) AS end, MAX(s.observed_at) AS last_at
    FROM snapshots s JOIN metrics m ON m.snapshot_id = s.id
    WHERE ${readings}
    GROUP BY s.connection_id, m.provider_metric_key, m.scope, m.window_start, COALESCE(m.window_end, m.resets_at)`);
  const coverage = new Map(
    db
      .all<CoverageRow>(
        sql`SELECT connection_id, MIN(observed_at) AS first_at, MAX(observed_at) AS last_at, COUNT(*) AS readings
          FROM snapshots WHERE connection_id IN (${ids}) AND observed_at BETWEEN ${from} AND ${to}
          GROUP BY connection_id`,
      )
      .map((row) => [row.connection_id, row]),
  );
  const failures = db.all<FailureRow>(sql`
    SELECT connection_id, started_at AS at, outcome FROM sync_runs
    WHERE connection_id IN (${ids}) AND started_at BETWEEN ${from} AND ${to}
      AND outcome IS NOT NULL AND outcome NOT IN ('succeeded', 'partial')
    ORDER BY started_at ASC`);
  const events = new AccountEventStore(db).between(from, to, connectionIds);

  return connectionIds.map((id) => {
    const series = new Map<string, HistorySeriesResult>();
    const open = (connection: string, key: string, scope: string) => {
      const mapKey = `${connection}\u0000${key}\u0000${scope}`;
      let entry = series.get(mapKey);
      if (!entry) {
        entry = { providerMetricKey: key, scope, points: [], windows: [] };
        series.set(mapKey, entry);
      }
      return { mapKey, entry };
    };
    for (const row of points) {
      if (row.connection_id === id)
        open(id, row.key, row.scope).entry.points.push([row.bucket, row.value]);
    }
    const byWindow = new Map<string, WindowRow[]>();
    for (const row of windows) {
      if (row.connection_id !== id) continue;
      const { mapKey } = open(id, row.key, row.scope);
      byWindow.set(mapKey, [...(byWindow.get(mapKey) ?? []), row]);
    }
    for (const [mapKey, rows] of byWindow) series.get(mapKey)!.windows = dedupeWindows(rows);
    const seen = coverage.get(id);
    return {
      id,
      coverage: {
        firstAt: seen?.first_at ?? null,
        lastAt: seen?.last_at ?? null,
        readings: seen?.readings ?? 0,
      },
      series: [...series.values()],
      failures: failures
        .filter((row) => row.connection_id === id)
        .map(({ at, outcome }) => ({ at, outcome })),
      events: events.filter((event) => event.connectionId === id),
    };
  });
}
