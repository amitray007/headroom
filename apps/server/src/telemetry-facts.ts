import type { Database } from "bun:sqlite";

import type { Settings } from "@headroom/core";

import type { ConnectCount, DailyFacts, RefreshCount } from "./telemetry.ts";

type Row = { readonly key: string; readonly n: number };

/** Turn grouped rows into `{ key: count }`. */
function countsOf(rows: readonly Row[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.key, row.n]));
}

function count(sqlite: Database, sql: string): number {
  return sqlite.query<{ n: number }, []>(sql).get()?.n ?? 0;
}

/** Sign-in attempts that finished since `since`. */
function connectsSince(sqlite: Database, since: number): ConnectCount[] {
  return sqlite
    .query<ConnectCount, [number]>(
      `SELECT provider, method, state, count(*) AS count FROM auth_attempts
       WHERE state IN ('succeeded', 'failed', 'expired', 'cancelled') AND updated_at >= ?
       GROUP BY provider, method, state ORDER BY provider, method, state`,
    )
    .all(since);
}

/** Refreshes that finished since `since`. */
function refreshesSince(sqlite: Database, since: number): RefreshCount[] {
  return sqlite
    .query<RefreshCount, [number]>(
      `SELECT c.provider AS provider, r.outcome AS outcome, count(*) AS count FROM sync_runs r
       JOIN connections c ON c.id = r.connection_id
       WHERE r.outcome IS NOT NULL AND r.finished_at >= ?
       GROUP BY c.provider, r.outcome ORDER BY c.provider, r.outcome`,
    )
    .all(since);
}

/** Which owner features are switched on or hold entries. Counts and flags only. */
function featuresOf(sqlite: Database, settings: Settings): Record<string, number | boolean> {
  const channels = countsOf(
    sqlite
      .query<Row, []>(
        "SELECT type AS key, count(*) AS n FROM notification_channels WHERE enabled = 1 GROUP BY type",
      )
      .all(),
  );
  return {
    account_actions: settings.accountActions,
    auto_reset_rules: count(sqlite, "SELECT count(*) AS n FROM auto_reset_rules WHERE enabled = 1"),
    spend_budgets: count(sqlite, "SELECT count(*) AS n FROM spend_budgets"),
    wallet_costs: count(sqlite, "SELECT count(*) AS n FROM wallet_costs"),
    wallet_top_ups: count(sqlite, "SELECT count(*) AS n FROM wallet_top_ups"),
    channels_telegram: channels["telegram"] ?? 0,
    channels_webhook: channels["webhook"] ?? 0,
    refresh_minutes: settings.refreshIntervalMinutes,
    history_days: settings.historyRetentionDays,
  };
}

/** The database half of the daily facts. */
export function activityFacts(
  sqlite: Database,
  settings: Settings,
  since: number,
): Pick<DailyFacts, "connects" | "refreshes" | "features"> {
  return {
    connects: connectsSince(sqlite, since),
    refreshes: refreshesSince(sqlite, since),
    features: featuresOf(sqlite, settings),
  };
}
