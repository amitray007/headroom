import { and, desc, eq, inArray, isNull, lt, ne, notInArray } from "drizzle-orm";

import type { Capability, ClassifiedError, CollectResult } from "./connector.ts";
import { type Db, schema } from "./db/index.ts";
import type { SyncRunOutcome } from "./enums.ts";

/**
 * Sync runs, snapshots, metrics, reset credits and capabilities.
 * A run is opened before collection and closed with an outcome; a snapshot
 * exists only for a run that produced observations.
 */

export type SnapshotRow = typeof schema.snapshots.$inferSelect;
export type MetricRow = typeof schema.metrics.$inferSelect;
export type ResetCreditRow = typeof schema.resetCredits.$inferSelect;
export type SyncRunRow = typeof schema.syncRuns.$inferSelect;
export type CapabilityRow = typeof schema.connectionCapabilities.$inferSelect;

export const schemaVersion = 1;

export class SnapshotStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  startRun(connectionId: string): SyncRunRow {
    const id = Bun.randomUUIDv7();
    this.db.insert(schema.syncRuns).values({ id, connectionId, startedAt: this.now() }).run();
    return this.db.select().from(schema.syncRuns).where(eq(schema.syncRuns.id, id)).get()!;
  }

  finishRun(runId: string, outcome: SyncRunOutcome, error?: ClassifiedError): void {
    const retryAfter =
      error?.retryAfterMs === undefined
        ? null
        : new Date(this.now().getTime() + error.retryAfterMs);
    this.db
      .update(schema.syncRuns)
      .set({
        finishedAt: this.now(),
        outcome,
        retryAfter,
        sanitizedError: error ? `${error.category}: ${error.message}` : null,
      })
      .where(eq(schema.syncRuns.id, runId))
      .run();
  }

  /**
   * Close every run still open as `interrupted`. Called once at startup: the process that
   * opened them is gone, and an open run would otherwise look in progress forever.
   */
  interruptUnfinished(): number {
    return this.db
      .update(schema.syncRuns)
      .set({ finishedAt: this.now(), outcome: "interrupted" })
      .where(isNull(schema.syncRuns.finishedAt))
      .returning({ id: schema.syncRuns.id })
      .all().length;
  }

  latestRun(connectionId: string): SyncRunRow | null {
    return (
      this.db
        .select()
        .from(schema.syncRuns)
        .where(eq(schema.syncRuns.connectionId, connectionId))
        .orderBy(desc(schema.syncRuns.startedAt))
        .limit(1)
        .get() ?? null
    );
  }

  /**
   * How many of the most recent finished runs, newest first, failed in a row. A run still in
   * progress is ignored. Reads at most `limit` runs.
   */
  failureStreak(connectionId: string, limit = 5): number {
    const runs = this.db
      .select({ outcome: schema.syncRuns.outcome })
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.connectionId, connectionId))
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(limit)
      .all();
    let streak = 0;
    for (const { outcome } of runs) {
      if (outcome === null) continue;
      if (outcome === "succeeded" || outcome === "partial") break;
      streak += 1;
    }
    return streak;
  }

  /** Persist one collection result. Metrics and reset credits are written in the same transaction. */
  record(
    connectionId: string,
    runId: string,
    result: CollectResult,
    connectorVersion: string,
  ): SnapshotRow {
    const snapshotId = Bun.randomUUIDv7();
    const receivedAt = this.now();
    this.db.transaction((tx) => {
      tx.insert(schema.snapshots)
        .values({
          id: snapshotId,
          connectionId,
          syncRunId: runId,
          observedAt: new Date(result.observedAt),
          receivedAt,
          connectorVersion,
          schemaVersion,
        })
        .run();
      for (const metric of result.metrics) {
        const valueNum = metric.valueText === null ? null : Number(metric.valueText);
        tx.insert(schema.metrics)
          .values({
            id: Bun.randomUUIDv7(),
            snapshotId,
            providerMetricKey: metric.providerMetricKey,
            kind: metric.kind,
            scope: metric.scope,
            valueText: metric.valueText,
            valueNum: valueNum === null || Number.isNaN(valueNum) ? null : valueNum,
            unit: metric.unit,
            unlimited: metric.unlimited ?? false,
            windowStart: toDate(metric.windowStart),
            windowEnd: toDate(metric.windowEnd),
            resetsAt: toDate(metric.resetsAt),
            availability: metric.availability,
            interface: metric.interface,
          })
          .run();
      }
      for (const credit of result.resetCredits ?? []) {
        tx.insert(schema.resetCredits)
          .values({
            id: Bun.randomUUIDv7(),
            snapshotId,
            providerCreditId: credit.providerCreditId,
            eligible: credit.eligible,
            usable: credit.usable,
            expiresAt: toDate(credit.expiresAt),
            cooldownUntil: toDate(credit.cooldownUntil),
            rawLabel: credit.rawLabel ?? null,
          })
          .run();
      }
    });
    return this.db
      .select()
      .from(schema.snapshots)
      .where(eq(schema.snapshots.id, snapshotId))
      .get()!;
  }

  latest(
    connectionId: string,
  ): { snapshot: SnapshotRow; metrics: MetricRow[]; resetCredits: ResetCreditRow[] } | null {
    const snapshot = this.db
      .select()
      .from(schema.snapshots)
      .where(eq(schema.snapshots.connectionId, connectionId))
      .orderBy(desc(schema.snapshots.observedAt), desc(schema.snapshots.receivedAt))
      .limit(1)
      .get();
    if (!snapshot) return null;
    return {
      snapshot,
      metrics: this.db
        .select()
        .from(schema.metrics)
        .where(eq(schema.metrics.snapshotId, snapshot.id))
        .all(),
      resetCredits: this.db
        .select()
        .from(schema.resetCredits)
        .where(eq(schema.resetCredits.snapshotId, snapshot.id))
        .all(),
    };
  }

  history(connectionId: string, limit = 500): SnapshotRow[] {
    return this.db
      .select()
      .from(schema.snapshots)
      .where(eq(schema.snapshots.connectionId, connectionId))
      .orderBy(desc(schema.snapshots.observedAt))
      .limit(limit)
      .all();
  }

  /**
   * Delete history older than `cutoff`, per connection, and keep each connection's newest
   * snapshot and newest sync run however old: the dashboard reads them. Metrics and reset credits
   * go with their snapshot through the foreign-key cascade. An action row that points at a pruned
   * snapshot loses that link, because the reference has no cascade and would block the delete.
   * A run that still owns a surviving snapshot stays, so the run cascade never takes one.
   * Each connection is one transaction that walks the (connection, time) indexes.
   */
  prune(cutoff: Date): { snapshots: number; syncRuns: number } {
    const counts = { snapshots: 0, syncRuns: 0 };
    const ids = this.db.select({ id: schema.connections.id }).from(schema.connections).all();
    for (const { id: connectionId } of ids) {
      this.db.transaction((tx) => {
        const newestSnapshot = tx
          .select({ id: schema.snapshots.id })
          .from(schema.snapshots)
          .where(eq(schema.snapshots.connectionId, connectionId))
          .orderBy(desc(schema.snapshots.observedAt), desc(schema.snapshots.receivedAt))
          .limit(1)
          .get();
        const newestRun = tx
          .select({ id: schema.syncRuns.id })
          .from(schema.syncRuns)
          .where(eq(schema.syncRuns.connectionId, connectionId))
          .orderBy(desc(schema.syncRuns.startedAt))
          .limit(1)
          .get();
        const oldSnapshots = and(
          eq(schema.snapshots.connectionId, connectionId),
          lt(schema.snapshots.observedAt, cutoff),
          newestSnapshot ? ne(schema.snapshots.id, newestSnapshot.id) : undefined,
        );
        tx.update(schema.accountActions)
          .set({ resultingSnapshotId: null })
          .where(
            inArray(
              schema.accountActions.resultingSnapshotId,
              tx.select({ id: schema.snapshots.id }).from(schema.snapshots).where(oldSnapshots),
            ),
          )
          .run();
        counts.snapshots += tx
          .delete(schema.snapshots)
          .where(oldSnapshots)
          .returning({ id: schema.snapshots.id })
          .all().length;
        counts.syncRuns += tx
          .delete(schema.syncRuns)
          .where(
            and(
              eq(schema.syncRuns.connectionId, connectionId),
              lt(schema.syncRuns.startedAt, cutoff),
              newestRun ? ne(schema.syncRuns.id, newestRun.id) : undefined,
              notInArray(
                schema.syncRuns.id,
                tx
                  .select({ id: schema.snapshots.syncRunId })
                  .from(schema.snapshots)
                  .where(eq(schema.snapshots.connectionId, connectionId)),
              ),
            ),
          )
          .returning({ id: schema.syncRuns.id })
          .all().length;
      });
    }
    return counts;
  }

  /** Replace the connection's capability rows with the connector's current view. */
  setCapabilities(connectionId: string, capabilities: readonly Capability[]): void {
    const checkedAt = this.now();
    this.db.transaction((tx) => {
      tx.delete(schema.connectionCapabilities)
        .where(eq(schema.connectionCapabilities.connectionId, connectionId))
        .run();
      for (const capability of capabilities) {
        tx.insert(schema.connectionCapabilities)
          .values({
            connectionId,
            metricOrAction: capability.metricOrAction,
            availability: capability.availability,
            interface: capability.interface,
            evidenceLevel: capability.evidenceLevel,
            reason: capability.reason ?? null,
            checkedAt,
          })
          .run();
      }
    });
  }

  capabilities(connectionId: string): CapabilityRow[] {
    return this.db
      .select()
      .from(schema.connectionCapabilities)
      .where(eq(schema.connectionCapabilities.connectionId, connectionId))
      .all();
  }
}

function toDate(value: number | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value);
}
