import type { ClassifiedError, Connector, Identity } from "../connector.ts";
import type { CredentialRecord, CredentialStore } from "../credentials.ts";
import type { ReconnectReason, SyncRunOutcome } from "../enums.ts";
import { LeaseHeldError, type LeaseStore } from "../leases.ts";
import type { ConnectionRow, ConnectionStore } from "../lifecycle.ts";
import type { SnapshotStore, SyncRunRow } from "../snapshots.ts";
import type { ConnectorRegistry } from "./connect.ts";
import { defaultRefreshLeadMs, outcomeFor, refreshAndStore } from "./connect.ts";

/**
 * One scheduled or manual collection for one connection: lease, refresh if due,
 * collect, classify, persist. Implements "Automatic refresh" and "Failure
 * classification" from docs/architecture/connections.md.
 */

export interface CollectionServiceOptions {
  readonly registry: ConnectorRegistry;
  readonly connections: ConnectionStore;
  readonly credentials: CredentialStore;
  readonly snapshots: SnapshotStore;
  readonly leases: LeaseStore;
  /** Refresh this long before the credential expires. */
  readonly refreshLeadMs?: number;
  readonly leaseTtlMs?: number;
  /** Re-check this long after the first rejection of a key that worked before. */
  readonly confirmRejectionMs?: number;
  readonly now?: () => Date;
}

export type CollectionOutcome =
  | {
      readonly status: "collected";
      readonly outcome: Extract<SyncRunOutcome, "succeeded" | "partial">;
    }
  | { readonly status: "failed"; readonly outcome: SyncRunOutcome; readonly error: ClassifiedError }
  | {
      readonly status: "skipped";
      readonly reason: "lease_held" | "not_collectable" | "no_credentials";
    };

export class CollectionService {
  private readonly refreshLeadMs: number;
  /** How long a lease lasts; an open run older than this has no live owner. */
  readonly leaseTtlMs: number;
  private readonly confirmRejectionMs: number;
  private readonly now: () => Date;

  constructor(private readonly deps: CollectionServiceOptions) {
    this.refreshLeadMs = deps.refreshLeadMs ?? defaultRefreshLeadMs;
    this.leaseTtlMs = deps.leaseTtlMs ?? 2 * 60 * 1000;
    this.confirmRejectionMs = deps.confirmRejectionMs ?? 2 * 60 * 1000;
    this.now = deps.now ?? (() => new Date());
  }

  async run(
    connectionId: string,
    holder = `collect:${Bun.randomUUIDv7()}`,
  ): Promise<CollectionOutcome> {
    const connection = this.deps.connections.get(connectionId);
    if (!connection) throw new Error("connection not found");
    if (connection.state === "paused" || connection.state === "reconnect_required") {
      return { status: "skipped", reason: "not_collectable" };
    }
    const connector = this.deps.registry.get(connection.provider);
    if (!connector) return { status: "skipped", reason: "not_collectable" };
    try {
      return await this.deps.leases.withLease(connectionId, holder, this.leaseTtlMs, () =>
        this.collect(connection, connector),
      );
    } catch (error) {
      if (error instanceof LeaseHeldError) return { status: "skipped", reason: "lease_held" };
      // Deleted while this ran (the lease or a write hit a foreign key): nothing left to collect.
      if (!this.deps.connections.get(connectionId)) {
        return { status: "skipped", reason: "not_collectable" };
      }
      throw error;
    }
  }

  private async collect(
    connection: ConnectionRow,
    connector: Connector,
  ): Promise<CollectionOutcome> {
    const record = this.deps.credentials.get(connection.id);
    if (!record) return { status: "skipped", reason: "no_credentials" };
    const previous = this.deps.snapshots.latestRun(connection.id);
    const run = this.deps.snapshots.startRun(connection.id);
    try {
      return await this.execute(connection, connector, record, previous, run.id);
    } catch (error) {
      // An unexpected throw must not leave the run open: the scheduler would wait on it forever.
      try {
        this.deps.snapshots.finishRun(run.id, "interrupted");
      } catch {
        // The original error matters more than a failure to record it.
      }
      throw error;
    }
  }

  private async execute(
    connection: ConnectionRow,
    connector: Connector,
    record: CredentialRecord,
    previous: SyncRunRow | null,
    runId: string,
  ): Promise<CollectionOutcome> {
    let credential = { secret: record.secret, expiresAt: record.expiresAt };
    const rejected = (error: ClassifiedError) =>
      this.rejected(connection, previous?.outcome ?? null, runId, error);

    // Proactive refresh when expiry is known and near.
    if (record.refreshState !== "not_refreshable" && credential.expiresAt !== null) {
      if (credential.expiresAt - this.refreshLeadMs <= this.now().getTime()) {
        const refreshed = await this.refresh(connection, connector, credential, runId);
        if (refreshed.status === "failed") return refreshed;
        if (refreshed.status === "refreshed") credential = refreshed.credential;
      }
    }

    const identity: Identity = {
      providerAccountId: connection.providerAccountId,
      workspaceId: connection.workspaceId,
      label: connection.label,
      assurance: "strong",
    };

    let result;
    try {
      result = await connector.collect(credential, identity);
    } catch (error) {
      const classified = connector.classify(error);
      // Reactive refresh: one refresh and one retry on an authentication failure.
      if (
        classified.category === "authentication_required" &&
        record.refreshState !== "not_refreshable"
      ) {
        const refreshed = await this.refresh(connection, connector, credential, runId);
        if (refreshed.status === "failed") return refreshed;
        if (refreshed.status === "refreshed") {
          credential = refreshed.credential;
          try {
            result = await connector.collect(credential, identity);
          } catch (retryError) {
            return rejected(connector.classify(retryError));
          }
        } else {
          return rejected(classified);
        }
      } else {
        return rejected(classified);
      }
    }

    this.deps.snapshots.record(connection.id, runId, result, connector.version);
    const partial =
      result.failures.length > 0 || result.metrics.some((m) => m.availability !== "available");
    const outcome = partial ? "partial" : "succeeded";
    this.deps.connections.markSuccess(
      connection.id,
      new Date(result.observedAt),
      outcome === "partial" ? "partial" : "ready",
    );
    this.deps.snapshots.finishRun(runId, outcome);
    return { status: "collected", outcome };
  }

  private async refresh(
    connection: ConnectionRow,
    connector: Connector,
    credential: { secret: Record<string, unknown>; expiresAt: number | null },
    runId: string,
  ): Promise<
    | {
        status: "refreshed";
        credential: { secret: Record<string, unknown>; expiresAt: number | null };
      }
    | { status: "not_refreshable" }
    | CollectionOutcome
  > {
    const result = await refreshAndStore(
      this.deps.credentials,
      connection.id,
      connector,
      credential,
    );
    switch (result.status) {
      case "refreshed":
        return { status: "refreshed", credential: result.credential };
      case "not_refreshable":
        return { status: "not_refreshable" };
      case "transient":
        this.deps.snapshots.finishRun(runId, outcomeFor(result.error), result.error);
        return { status: "failed", outcome: outcomeFor(result.error), error: result.error };
      case "rejected":
        return this.fail(connection.id, runId, result.error, "refresh_rejected");
      default:
        return assertNever(result);
    }
  }

  /**
   * A definitive failure on a connection that has worked before is confirmed once: the first
   * closes the run as a failure and schedules a short re-check, the same failure again in a row
   * disconnects. A connection that never worked disconnects on the first.
   */
  private rejected(
    connection: ConnectionRow,
    previousOutcome: SyncRunOutcome | null,
    runId: string,
    error: ClassifiedError,
  ): CollectionOutcome {
    const outcome = outcomeFor(error);
    // The same failure twice in a row confirms it, whatever its kind, so a repeating one never loops on re-checks.
    const firstStrike =
      error.class === "definitive" &&
      connection.lastSuccessAt !== null &&
      previousOutcome !== outcome;
    if (!firstStrike) return this.fail(connection.id, runId, error, "token_rejected");
    const recheck: ClassifiedError = {
      ...error,
      class: "transient",
      retryAfterMs: this.confirmRejectionMs,
    };
    this.deps.snapshots.finishRun(runId, outcome, recheck);
    return { status: "failed", outcome, error: recheck };
  }

  /** Close the run; change connection state only for a definitive class. */
  private fail(
    connectionId: string,
    runId: string,
    error: ClassifiedError,
    definitiveReason: ReconnectReason,
  ): CollectionOutcome {
    const outcome = outcomeFor(error);
    this.deps.snapshots.finishRun(runId, outcome, error);
    if (error.class === "definitive") {
      this.deps.connections.requireReconnect(connectionId, definitiveReason);
    }
    return { status: "failed", outcome, error };
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${String(value)}`);
}
