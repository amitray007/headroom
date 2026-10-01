import type { ClassifiedError, Connector, Identity } from "../connector.ts";
import type { CredentialStore } from "../credentials.ts";
import type { ReconnectReason, SyncRunOutcome } from "../enums.ts";
import { LeaseHeldError, type LeaseStore } from "../leases.ts";
import type { ConnectionRow, ConnectionStore } from "../lifecycle.ts";
import type { SnapshotStore } from "../snapshots.ts";
import type { ConnectorRegistry } from "./connect.ts";
import { outcomeFor } from "./connect.ts";

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
  private readonly leaseTtlMs: number;
  private readonly now: () => Date;

  constructor(private readonly deps: CollectionServiceOptions) {
    this.refreshLeadMs = deps.refreshLeadMs ?? 5 * 60 * 1000;
    this.leaseTtlMs = deps.leaseTtlMs ?? 2 * 60 * 1000;
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
      throw error;
    }
  }

  private async collect(
    connection: ConnectionRow,
    connector: Connector,
  ): Promise<CollectionOutcome> {
    const record = this.deps.credentials.get(connection.id);
    if (!record) return { status: "skipped", reason: "no_credentials" };
    let credential = { secret: record.secret, expiresAt: record.expiresAt };
    const run = this.deps.snapshots.startRun(connection.id);

    // Proactive refresh when expiry is known and near.
    if (record.refreshState !== "not_refreshable" && credential.expiresAt !== null) {
      if (credential.expiresAt - this.refreshLeadMs <= this.now().getTime()) {
        const refreshed = await this.refresh(connection, connector, credential, run.id);
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
        const refreshed = await this.refresh(connection, connector, credential, run.id);
        if (refreshed.status === "failed") return refreshed;
        if (refreshed.status === "refreshed") {
          credential = refreshed.credential;
          try {
            result = await connector.collect(credential, identity);
          } catch (retryError) {
            return this.fail(
              connection.id,
              run.id,
              connector.classify(retryError),
              "token_rejected",
            );
          }
        } else {
          return this.fail(connection.id, run.id, classified, "token_rejected");
        }
      } else {
        return this.fail(connection.id, run.id, classified, "token_rejected");
      }
    }

    this.deps.snapshots.record(connection.id, run.id, result, connector.version);
    const partial =
      result.failures.length > 0 || result.metrics.some((m) => m.availability !== "available");
    const outcome = partial ? "partial" : "succeeded";
    this.deps.connections.markSuccess(
      connection.id,
      new Date(result.observedAt),
      outcome === "partial" ? "partial" : "ready",
    );
    this.deps.snapshots.finishRun(run.id, outcome);
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
    let result;
    try {
      result = await connector.refresh(credential);
    } catch (error) {
      result = { status: "transient" as const, error: connector.classify(error) };
    }
    switch (result.status) {
      case "refreshed":
        // Persist the rotated token before using it.
        this.deps.credentials.put(connection.id, result.credential, "fresh");
        return { status: "refreshed", credential: result.credential };
      case "not_refreshable":
        this.deps.credentials.setRefreshState(connection.id, "not_refreshable");
        return { status: "not_refreshable" };
      case "transient":
        this.deps.credentials.setRefreshState(connection.id, "refresh_due");
        this.deps.snapshots.finishRun(runId, outcomeFor(result.error), result.error);
        return { status: "failed", outcome: outcomeFor(result.error), error: result.error };
      case "rejected":
        this.deps.credentials.setRefreshState(connection.id, "refresh_failed");
        return this.fail(connection.id, runId, result.error, "refresh_rejected");
      default:
        return assertNever(result);
    }
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
