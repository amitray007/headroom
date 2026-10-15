import { sql } from "drizzle-orm";

import { AccountEventStore } from "./account-events.ts";
import type { AccountEvent } from "./automation-schemas.ts";
import type { Db } from "./db/index.ts";
import type { SyncRunOutcome } from "./enums.ts";

/**
 * Usage history for the Analytics view, read from stored snapshots. Only `quota_percentage` metrics
 * with a number: the same percent-of-limit readings the overview draws as meters. One streamed scan
 * of the readings is folded by JS into buckets and windows; coverage and failures are small SQL queries.
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
interface ReadingRow {
  connection: string;
  key: string;
  scope: string;
  at: number;
  value: number;
  start: number | null;
  end: number | null;
}
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
 * Cheap change marker for the history of these accounts: the newest snapshot, the newest run with its
 * finish and outcome (so a run that later finishes as a failure changes it), and the newest event. Each is
 * one lookup on an index that starts with the connection, so it stays fast however much history is stored.
 */
export function historyMarker(db: Db, connectionIds: readonly string[]): string {
  if (connectionIds.length === 0) return "";
  const rows = db.values<(number | string | null)[]>(sql`
    SELECT
      (SELECT MAX(observed_at) FROM snapshots WHERE connection_id = c.id),
      (SELECT started_at || '/' || COALESCE(finished_at, '') || '/' || COALESCE(outcome, '')
        FROM sync_runs WHERE connection_id = c.id ORDER BY started_at DESC LIMIT 1),
      (SELECT MAX(occurred_at) FROM account_events WHERE connection_id = c.id)
    FROM connections c WHERE c.id IN (${idList(connectionIds)}) ORDER BY c.id`);
  return rows.map((row) => row.join(":")).join(";");
}

/** A late insert can carry an observation time a little older than the newest one folded; reread this much. */
const overlapMs = 60 * 60_000;

/** Readings folded into hours for one bucket length and time zone shift, kept between requests. */
interface Fold {
  readonly bucketMs: number;
  readonly shift: number;
  readonly ids: ReadonlySet<string>;
  /** Every stored reading at or after this is folded in. */
  floor: number;
  /** The newest observation time folded in. */
  newest: number;
  readonly byConnection: Map<string, Map<string, SeriesAcc>>;
}

const readingsSql = (count: number, extra = "") =>
  `SELECT s.connection_id AS connection, m.provider_metric_key AS key, m.scope AS scope,
    s.observed_at AS at, m.value_num AS value, m.window_start AS start,
    COALESCE(m.window_end, m.resets_at) AS end
  FROM snapshots s JOIN metrics m ON m.snapshot_id = s.id
  WHERE s.connection_id IN (${Array.from({ length: count }, () => "?").join(", ")}) AND s.observed_at BETWEEN ? AND ?
    AND m.kind = 'quota_percentage' AND m.availability = 'available' AND m.value_num IS NOT NULL${extra}`;

const seriesKey = (key: string, scope: string): string => `${key}\u0000${scope}`;

/**
 * Fold the readings of `ids` observed in [from, to] into `fold`. The statement is streamed, so memory holds one
 * entry per hour and window, not one per reading. Folding a reading twice changes nothing: an hour keeps its
 * highest value and a window slot its latest reading, so an overlapping reread is safe.
 */
function foldReadings(db: Db, fold: Fold, ids: readonly string[], from: number, to: number): void {
  const rows = db.$client
    .query<ReadingRow, (string | number)[]>(readingsSql(ids.length))
    .iterate(...ids, from, to);
  const { bucketMs, shift } = fold;
  for (const { connection, key, scope, at, value, start, end } of rows) {
    let all = fold.byConnection.get(connection);
    if (!all) fold.byConnection.set(connection, (all = new Map()));
    const mapKey = seriesKey(key, scope);
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
    if (at > fold.newest) fold.newest = at;
  }
}

/** Drop hours and windows wholly before `floor`, so a long-lived fold holds at most the longest range. */
function trimFold(fold: Fold, floor: number): void {
  if (floor <= fold.floor) return;
  fold.floor = floor;
  for (const all of fold.byConnection.values()) {
    for (const acc of all.values()) {
      for (const bucket of acc.points.keys())
        if (bucket + fold.bucketMs <= floor) acc.points.delete(bucket);
      for (const [slot, held] of acc.windows) if (held.at < floor) acc.windows.delete(slot);
    }
  }
}

/**
 * The highest reading of each limit in one account's first hour of the range, read again from the database:
 * the fold's value for that hour can include readings from before the range or since pruned.
 */
function edgeHour(db: Db, id: string, from: number, to: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of db.$client
    .query<ReadingRow, (string | number)[]>(readingsSql(1))
    .iterate(id, from, to)) {
    const mapKey = seriesKey(row.key, row.scope);
    const seen = out.get(mapKey);
    if (seen === undefined || row.value > seen) out.set(mapKey, row.value);
  }
  return out;
}

export interface HistoryReader {
  read: (db: Db, range: HistoryRange) => HistoryConnectionResult[];
}

/**
 * A history reader that keeps its hourly fold between calls. The first call for a time zone scans the range; each
 * later call scans only the readings since the newest one it folded (with an hour of overlap for late inserts),
 * so a request after a sync reads a few rows instead of the whole range. The result equals a fresh read:
 *
 * - The first hour of each account is read again from the database, since the fold may hold older readings.
 * - Readings are deleted only by the retention prune, oldest first, and an account's first stored reading in the
 *   range bounds what is shown, so a pruned reading never shows.
 * - A new account, a range that starts before the fold, or a new time zone scans in full.
 *
 * `keepMs` is the longest range callers ask for; the fold drops anything older. It keeps `keep` time zones.
 */
export function createHistoryReader(options: { keepMs: number; keep?: number }): HistoryReader {
  const folds = new Map<string, Fold>();
  const keep = options.keep ?? 4;
  return {
    read(db, range) {
      const { from, to, bucketMs, connectionIds } = range;
      if (connectionIds.length === 0) return [];
      const shift = (range.tzOffsetMinutes ?? 0) * 60_000;
      const key = `${bucketMs}|${shift}`;
      let fold = folds.get(key);
      const stale =
        fold === undefined ||
        fold.floor > from ||
        connectionIds.some((id) => !fold!.ids.has(id)) ||
        fold.ids.size !== connectionIds.length;
      let fresh = false;
      if (fold === undefined || stale) {
        fold = {
          bucketMs,
          shift,
          ids: new Set(connectionIds),
          floor: from,
          newest: Number.NEGATIVE_INFINITY,
          byConnection: new Map(),
        };
        foldReadings(db, fold, connectionIds, from, to);
        fresh = true;
      } else {
        foldReadings(db, fold, connectionIds, Math.max(fold.floor, fold.newest - overlapMs), to);
        trimFold(fold, to - options.keepMs);
      }
      folds.delete(key);
      folds.set(key, fold);
      if (folds.size > keep) folds.delete(folds.keys().next().value!);
      return assemble(db, fold, range, fresh);
    },
  };
}

/** Coverage, failures and events are small queries; the series come from the fold. */
function assemble(
  db: Db,
  fold: Fold,
  range: HistoryRange,
  fresh: boolean,
): HistoryConnectionResult[] {
  const { from, to, bucketMs, connectionIds } = range;
  const ids = idList(connectionIds);
  const { shift } = fold;
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
    const series: HistorySeriesResult[] = [];
    if (seen !== undefined) {
      // Nothing before the account's first stored reading in the range counts: not an older reading the fold
      // still holds, and not one the retention prune has since deleted.
      const first = seen.first_at;
      const edge = Math.floor((first + shift) / bucketMs) * bucketMs - shift;
      const edgeValues = fresh ? null : edgeHour(db, id, first, Math.min(to, edge + bucketMs - 1));
      for (const acc of fold.byConnection.get(id)?.values() ?? []) {
        const points: [number, number][] = [];
        for (const [bucket, value] of acc.points) {
          if (bucket < edge) continue;
          if (bucket === edge && edgeValues !== null) {
            const exact = edgeValues.get(seriesKey(acc.providerMetricKey, acc.scope));
            if (exact !== undefined) points.push([bucket, exact]);
          } else points.push([bucket, value]);
        }
        if (points.length === 0) continue;
        series.push({
          providerMetricKey: acc.providerMetricKey,
          scope: acc.scope,
          points: points.toSorted((a, b) => a[0] - b[0]),
          windows: dedupeWindows([...acc.windows.values()].filter((held) => held.at >= first)),
        });
      }
    }
    return {
      id,
      coverage: {
        firstAt: seen?.first_at ?? null,
        lastAt: seen?.last_at ?? null,
        readings: seen?.readings ?? 0,
      },
      series: series.toSorted(
        (a, b) =>
          a.providerMetricKey.localeCompare(b.providerMetricKey) || a.scope.localeCompare(b.scope),
      ),
      failures: failuresBy.get(id) ?? [],
      events: eventsBy.get(id) ?? [],
    };
  });
}

/** One full read of the range, with nothing kept. */
export function readHistory(db: Db, range: HistoryRange): HistoryConnectionResult[] {
  return createHistoryReader({ keepMs: range.to - range.from }).read(db, range);
}
