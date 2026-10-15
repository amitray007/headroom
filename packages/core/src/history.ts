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

/** Readings folded into hours for one bucket length and time zone shift, kept between requests. */
interface Fold {
  readonly bucketMs: number;
  readonly shift: number;
  readonly ids: ReadonlySet<string>;
  /** Every stored reading at or after this is folded in. */
  floor: number;
  /**
   * Every snapshot up to this rowid is folded in or older than `floor`. Rowids grow with each insert, so a late
   * insert or a provider-cached reading with an old observation time is still found.
   */
  seen: number;
  readonly byConnection: Map<string, Map<string, SeriesAcc>>;
}

const marks = (count: number): string => Array.from({ length: count }, () => "?").join(", ");

const readingColumns = `s.connection_id AS connection, m.provider_metric_key AS key, m.scope AS scope,
    s.observed_at AS at, m.value_num AS value, m.window_start AS start,
    COALESCE(m.window_end, m.resets_at) AS end
  FROM snapshots s JOIN metrics m ON m.snapshot_id = s.id`;
const usable = `m.kind = 'quota_percentage' AND m.availability = 'available' AND m.value_num IS NOT NULL`;

/** The readings of `count` accounts observed in a range, on the (connection, observed_at) index. */
const rangeSql = (count: number) =>
  `SELECT ${readingColumns}
  WHERE s.connection_id IN (${marks(count)}) AND s.observed_at BETWEEN ? AND ? AND ${usable}`;

/** The readings of `count` accounts in snapshots inserted after a rowid, observed in a range. */
const insertedSql = (count: number) =>
  `SELECT ${readingColumns}
  WHERE s.rowid > ? AND s.rowid <= ? AND s.connection_id IN (${marks(count)})
    AND s.observed_at BETWEEN ? AND ? AND ${usable}`;

const seriesKey = (key: string, scope: string): string => `${key}\u0000${scope}`;

/**
 * Fold readings into `fold`. The statement is streamed, so memory holds one entry per hour and window, not one per
 * reading. Folding a reading twice changes nothing: an hour keeps its highest value and a window slot its latest
 * reading, so a reread is safe.
 */
function foldRows(fold: Fold, rows: Iterable<ReadingRow>): void {
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
  }
}

/**
 * The rowid the fold can claim after reading up to `to`: the newest snapshot, or just before the first one of
 * these accounts observed after `to`, so a reading from a skewed provider clock is folded once `to` passes it.
 */
function seenUpTo(db: Db, ids: readonly string[], after: number, to: number): number {
  const [newest] = db.$client
    .query<{ id: number | null }, []>("SELECT MAX(rowid) AS id FROM snapshots")
    .all();
  const [ahead] = db.$client
    .query<{ id: number | null }, (string | number)[]>(
      `SELECT MIN(rowid) AS id FROM snapshots
      WHERE connection_id IN (${marks(ids.length)}) AND observed_at > ? AND rowid > ?`,
    )
    .all(...ids, to, after);
  const top = newest?.id ?? 0;
  const first = ahead?.id ?? null;
  return first === null ? top : Math.min(top, first - 1);
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
 * The highest reading of each limit in each account's first hour of the range, read again from the database in
 * one statement: the fold's value for that hour can include readings from before the range or since pruned.
 */
function edgeHours(
  db: Db,
  edges: readonly { id: string; from: number; to: number }[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  if (edges.length === 0) return out;
  const rows = db.$client
    .query<{ connection: string; key: string; scope: string; value: number }, (string | number)[]>(
      `WITH edge(id, lo, hi) AS (VALUES ${edges.map(() => "(?, ?, ?)").join(", ")})
      SELECT s.connection_id AS connection, m.provider_metric_key AS key, m.scope AS scope,
        MAX(m.value_num) AS value
      FROM edge CROSS JOIN snapshots s ON s.connection_id = edge.id AND s.observed_at BETWEEN edge.lo AND edge.hi
      JOIN metrics m ON m.snapshot_id = s.id
      WHERE ${usable}
      GROUP BY s.connection_id, m.provider_metric_key, m.scope`,
    )
    .all(...edges.flatMap((edge) => [edge.id, edge.from, edge.to]));
  for (const row of rows) {
    let all = out.get(row.connection);
    if (!all) out.set(row.connection, (all = new Map()));
    all.set(seriesKey(row.key, row.scope), row.value);
  }
  return out;
}

export interface HistoryReader {
  read: (db: Db, range: HistoryRange) => HistoryConnectionResult[];
}

/**
 * A history reader that keeps its hourly fold between calls. The first call for a time zone scans the range; each
 * later call scans only the snapshots inserted since, by rowid, so a request after a sync reads a few rows instead
 * of the whole range. The result equals a fresh read:
 *
 * - The first hour of each account is read again from the database, since the fold may hold older readings.
 * - Readings are deleted only by the retention prune, oldest first, and an account's first stored reading in the
 *   range bounds what is shown, so a pruned reading never shows.
 * - A new account, a range that starts before the fold, a new time zone, or a newest rowid below the one folded
 *   (the newest snapshots were deleted) scans in full.
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
      let seen = seenUpTo(db, connectionIds, fold?.seen ?? 0, to);
      const stale =
        fold === undefined ||
        fold.floor > from ||
        seen < fold.seen ||
        connectionIds.some((id) => !fold!.ids.has(id)) ||
        fold.ids.size !== connectionIds.length;
      let fresh = false;
      if (fold === undefined || stale) {
        if (fold !== undefined) seen = seenUpTo(db, connectionIds, 0, to);
        fold = {
          bucketMs,
          shift,
          ids: new Set(connectionIds),
          floor: from,
          seen,
          byConnection: new Map(),
        };
        foldRows(
          fold,
          db.$client
            .query<ReadingRow, (string | number)[]>(rangeSql(connectionIds.length))
            .iterate(...connectionIds, from, to),
        );
        fresh = true;
      } else {
        foldRows(
          fold,
          db.$client
            .query<ReadingRow, (string | number)[]>(insertedSql(connectionIds.length))
            .iterate(fold.seen, seen, ...connectionIds, fold.floor, to),
        );
        fold.seen = seen;
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

  // Nothing before an account's first stored reading in the range counts: not an older reading the fold still
  // holds, and not one the retention prune has since deleted.
  const edgeOf = (first: number): number =>
    Math.floor((first + shift) / bucketMs) * bucketMs - shift;
  const exactEdges = fresh
    ? null
    : edgeHours(
        db,
        [...coverage.values()].map((row) => ({
          id: row.connection_id,
          from: row.first_at,
          to: Math.min(to, edgeOf(row.first_at) + bucketMs - 1),
        })),
      );

  return connectionIds.map((id) => {
    const seen = coverage.get(id);
    const series: HistorySeriesResult[] = [];
    if (seen !== undefined) {
      const first = seen.first_at;
      const edge = edgeOf(first);
      const edgeValues =
        exactEdges === null ? null : (exactEdges.get(id) ?? new Map<string, number>());
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
