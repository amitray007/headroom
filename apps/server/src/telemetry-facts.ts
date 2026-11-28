import type { Database } from "bun:sqlite";

import type { Settings } from "@headroom/core";

import type {
  ActionCount,
  AvailabilityCount,
  ConnectCount,
  DailyFacts,
  DeliveryCount,
  RefreshCount,
} from "./telemetry.ts";

type Row = { readonly key: string; readonly n: number };

function countsOf(rows: readonly Row[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.key, row.n]));
}

function count(sqlite: Database, sql: string): number {
  return sqlite.query<{ n: number }, []>(sql).get()?.n ?? 0;
}

function connectsSince(sqlite: Database, since: number): ConnectCount[] {
  return sqlite
    .query<ConnectCount, [number]>(
      `SELECT provider, method, state, count(*) AS count FROM auth_attempts
       WHERE state IN ('succeeded', 'failed', 'expired', 'cancelled') AND updated_at >= ?
       GROUP BY provider, method, state ORDER BY provider, method, state`,
    )
    .all(since);
}

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
function featuresOf(
  sqlite: Database,
  settings: Settings,
): Record<string, number | boolean | string> {
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
    limits_view: settings.limitsView,
    low_threshold_percent: settings.lowThresholdPercent,
    time_style: settings.timeStyle,
    clock: settings.clock,
    density: settings.density,
    detailed_order: settings.detailedOrder,
    keep_inactive_last: settings.keepInactiveLast,
    wallet_currency: settings.walletCurrency ?? "auto",
    notification_kinds_on: Object.values(settings.notifications.kinds).filter(Boolean).length,
    notification_sessions: settings.notifications.includeSessions,
    notification_lead_days: settings.notifications.resetLeadDays,
    muted_providers: settings.notifications.mutedProviders.length,
  };
}

/** Account actions, owner-pressed or automatic, that ended since `since`. */
function actionsSince(sqlite: Database, since: number): ActionCount[] {
  return sqlite
    .query<ActionCount, [number]>(
      `SELECT c.provider AS provider, a.action AS action, a.origin AS origin, a.state AS state,
         count(*) AS count FROM account_actions a
       JOIN connections c ON c.id = a.connection_id
       WHERE a.state IN ('succeeded', 'failed', 'uncertain') AND coalesce(a.completed_at, a.requested_at) >= ?
       GROUP BY c.provider, a.action, a.origin, a.state ORDER BY c.provider, a.action, a.origin, a.state`,
    )
    .all(since);
}

/** Notification sends last tried since `since`, by channel type and result. */
function deliveriesSince(sqlite: Database, since: number): DeliveryCount[] {
  return sqlite
    .query<DeliveryCount, [number]>(
      `SELECT ch.type AS channel, d.status AS status, d.failure AS failure, count(*) AS count
       FROM notification_deliveries d JOIN notification_channels ch ON ch.id = d.channel_id
       WHERE d.last_attempt_at >= ?
       GROUP BY ch.type, d.status, d.failure ORDER BY ch.type, d.status, d.failure`,
    )
    .all(since);
}

/** Metrics in each connection's newest reading, by provider and availability. Many `unknown` hint at a broken endpoint. */
function metricAvailability(sqlite: Database): AvailabilityCount[] {
  return sqlite
    .query<AvailabilityCount, []>(
      `SELECT c.provider AS provider, m.availability AS availability, count(*) AS count
       FROM metrics m
       JOIN snapshots s ON s.id = m.snapshot_id
       JOIN connections c ON c.id = s.connection_id
       WHERE s.id = (SELECT id FROM snapshots WHERE connection_id = c.id ORDER BY observed_at DESC LIMIT 1)
       GROUP BY c.provider, m.availability ORDER BY c.provider, m.availability`,
    )
    .all();
}

/** The database half of the daily facts. */
export function activityFacts(
  sqlite: Database,
  settings: Settings,
  since: number,
): Pick<DailyFacts, "connects" | "refreshes" | "actions" | "deliveries" | "metrics" | "features"> {
  return {
    metrics: metricAvailability(sqlite),
    connects: connectsSince(sqlite, since),
    actions: actionsSince(sqlite, since),
    deliveries: deliveriesSince(sqlite, since),
    refreshes: refreshesSince(sqlite, since),
    features: featuresOf(sqlite, settings),
  };
}
