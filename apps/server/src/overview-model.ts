import { z } from "zod";

import {
  availabilitySchema,
  interfaceLabelSchema,
  metricKindSchema,
  splitLabel,
  syncRunOutcomeSchema,
} from "@headroom/core";

import type { AppContext } from "./bootstrap.ts";
import { metricJson, ms, resetCreditJson } from "./routes/serialize.ts";

/** What the overview rows need from the context. A narrow pick lets bootstrap call it before the context exists. */
export type OverviewSource = Pick<
  AppContext,
  "config" | "sqlite" | "order" | "connections" | "actions"
>;

/** Finished runs the failure streak looks at, newest first. Matches `SnapshotStore.failureStreak`. */
const streakRuns = 5;

/** Each connection's newest snapshot id, in `SnapshotStore.latest`'s order. One index seek per connection. */
const latestSnapshotIds = `SELECT (SELECT s.id FROM snapshots s WHERE s.connection_id = c.id
  ORDER BY s.observed_at DESC, s.received_at DESC LIMIT 1) FROM connections c`;

/** SQLite hands back snake_case rows with integers for dates and booleans; these read them the way the Drizzle schema does. */
const timestamp = z
  .number()
  .nullable()
  .transform((value) => (value === null ? null : new Date(value)));
const flag = z.number().transform((value) => value === 1);

const runRows = z.array(
  z
    .object({
      connection_id: z.string(),
      started_at: z.number(),
      finished_at: z.number().nullable(),
      outcome: syncRunOutcomeSchema.nullable(),
      sanitized_error: z.string().nullable(),
    })
    .transform((row) => ({
      connectionId: row.connection_id,
      startedAt: new Date(row.started_at),
      finishedAt: row.finished_at === null ? null : new Date(row.finished_at),
      outcome: row.outcome,
      sanitizedError: row.sanitized_error,
    })),
);
type RunRow = z.output<typeof runRows>[number];

const snapshotRows = z.array(
  z
    .object({ id: z.string(), connection_id: z.string(), observed_at: z.number() })
    .transform((row) => ({
      id: row.id,
      connectionId: row.connection_id,
      observedAt: row.observed_at,
    })),
);

const metricRows = z.array(
  z
    .object({
      id: z.string(),
      snapshot_id: z.string(),
      provider_metric_key: z.string(),
      kind: metricKindSchema,
      scope: z.string(),
      value_text: z.string().nullable(),
      value_num: z.number().nullable(),
      unit: z.string(),
      unlimited: flag,
      window_start: timestamp,
      window_end: timestamp,
      resets_at: timestamp,
      availability: availabilitySchema,
      interface: interfaceLabelSchema,
    })
    .transform((row) => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      providerMetricKey: row.provider_metric_key,
      kind: row.kind,
      scope: row.scope,
      valueText: row.value_text,
      valueNum: row.value_num,
      unit: row.unit,
      unlimited: row.unlimited,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      resetsAt: row.resets_at,
      availability: row.availability,
      interface: row.interface,
    })),
);

const resetCreditRows = z.array(
  z
    .object({
      id: z.string(),
      snapshot_id: z.string(),
      provider_credit_id: z.string(),
      eligible: flag,
      usable: flag,
      expires_at: timestamp,
      cooldown_until: timestamp,
      raw_label: z.string().nullable(),
    })
    .transform((row) => ({
      id: row.id,
      snapshotId: row.snapshot_id,
      providerCreditId: row.provider_credit_id,
      eligible: row.eligible,
      usable: row.usable,
      expiresAt: row.expires_at,
      cooldownUntil: row.cooldown_until,
      rawLabel: row.raw_label,
    })),
);

function grouped<Row>(rows: readonly Row[], key: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group) group.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

/**
 * Latest run, failure streak, latest snapshot, its metrics and reset credits for every connection in four
 * statements instead of five per connection. The correlated subqueries walk the (connection, time)
 * indexes, so a connection costs a few index seeks, never a table scan. Rows and order match
 * `SnapshotStore.latestRun`, `failureStreak` and `latest`.
 */
function loadLatest(sqlite: OverviewSource["sqlite"]) {
  // CROSS JOIN pins connections as the outer loop; a plain JOIN lets SQLite scan all of sync_runs.
  // Every run from each connection's `streakRuns`-th newest start onward. Ties only add rows; the first
  // `streakRuns` of each group are kept.
  const recent = runRows.parse(
    sqlite
      .query(
        `SELECT r.connection_id, r.started_at, r.finished_at, r.outcome, r.sanitized_error
         FROM connections c CROSS JOIN sync_runs r ON r.connection_id = c.id
         WHERE r.started_at >= COALESCE((SELECT started_at FROM sync_runs WHERE connection_id = c.id
           ORDER BY started_at DESC LIMIT 1 OFFSET ${streakRuns - 1}), 0)
         ORDER BY r.started_at DESC`,
      )
      .all(),
  );
  const runs = grouped(recent, (run) => run.connectionId);
  for (const [id, group] of runs) runs.set(id, group.slice(0, streakRuns));

  const snapshots = new Map(
    snapshotRows
      .parse(
        sqlite
          .query(
            `SELECT id, connection_id, observed_at FROM snapshots WHERE id IN (${latestSnapshotIds})`,
          )
          .all(),
      )
      .map((snapshot) => [snapshot.connectionId, snapshot]),
  );
  const metrics = grouped(
    metricRows.parse(
      sqlite
        .query(`SELECT * FROM metrics WHERE snapshot_id IN (${latestSnapshotIds}) ORDER BY rowid`)
        .all(),
    ),
    (metric) => metric.snapshotId,
  );
  const resetCredits = grouped(
    resetCreditRows.parse(
      sqlite
        .query(
          `SELECT * FROM reset_credits WHERE snapshot_id IN (${latestSnapshotIds}) ORDER BY rowid`,
        )
        .all(),
    ),
    (credit) => credit.snapshotId,
  );
  return { runs, snapshots, metrics, resetCredits };
}

/** How many of the newest finished runs failed in a row; a run still open is skipped. */
function failureStreak(runs: readonly RunRow[]): number {
  let streak = 0;
  for (const { outcome } of runs) {
    if (outcome === null) continue;
    if (outcome === "succeeded" || outcome === "partial") break;
    streak += 1;
  }
  return streak;
}

/**
 * Every account with its latest snapshot, run and action state, in the owner's order. The
 * overview route returns it as is, and the notification dispatcher derives events from it.
 */
export function overviewConnections(source: OverviewSource, now: number) {
  const staleAfterMs = source.config.staleAfterSeconds * 1000;
  const connections = source.order.arrange(source.connections.list());
  const { runs, snapshots, metrics, resetCredits } = loadLatest(source.sqlite);
  return connections.map((connection) => {
    const connectionRuns = runs.get(connection.id) ?? [];
    const run = connectionRuns[0];
    const snapshot = snapshots.get(connection.id);
    const lastSuccessAt = ms(connection.lastSuccessAt);
    const { identity, plan } = splitLabel(connection.provider, connection.label);
    return {
      id: connection.id,
      provider: connection.provider,
      scope: connection.scope,
      state: connection.state,
      reconnectReason: connection.reconnectReason,
      interface: connection.interface,
      authMethod: connection.authMethod,
      name: connection.displayName,
      identity,
      plan,
      createdAt: connection.createdAt.getTime(),
      lastSuccessAt,
      stale: lastSuccessAt === null ? false : now - lastSuccessAt > staleAfterMs,
      latestRun: run
        ? {
            startedAt: run.startedAt.getTime(),
            finishedAt: ms(run.finishedAt),
            outcome: run.outcome,
            error: run.sanitizedError,
            failureStreak: failureStreak(connectionRuns),
          }
        : null,
      snapshot: snapshot
        ? {
            observedAt: snapshot.observedAt,
            metrics: (metrics.get(snapshot.id) ?? []).map(metricJson),
            resetCredits: (resetCredits.get(snapshot.id) ?? []).map(resetCreditJson),
          }
        : null,
      actions: {
        enabled: source.actions.enabled,
        supported: [...source.actions.supported(connection.provider)],
      },
    };
  });
}

export type OverviewConnectionLike = ReturnType<typeof overviewConnections>[number];
