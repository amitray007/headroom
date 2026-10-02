import type { AccountActionRow, ActionStore } from "../actions.ts";
import type { ActionResult } from "../connector.ts";
import type { CredentialStore } from "../credentials.ts";
import type { AccountActionKind } from "../enums.ts";
import { LeaseHeldError, type LeaseStore } from "../leases.ts";
import type { ConnectionStore } from "../lifecycle.ts";
import type { SnapshotStore } from "../snapshots.ts";
import type { CollectionOutcome, CollectionService } from "./collect.ts";
import type { ConnectorRegistry } from "./connect.ts";

/**
 * Owner-triggered account mutations. Implements "Actions" in docs/architecture/data-model.md:
 * an action row exists before the provider call and its id is the idempotency key; the call
 * runs under the connection lease; `uncertain` is recorded explicitly and never retried; a
 * successful action is followed by one ordinary collection so the dashboard shows the result.
 *
 * Two gates sit in front of every action: the `HEADROOM_ENABLE_ACTIONS` flag plus the owner's `accountActions` setting, both off by default,
 * and an explicit `confirm` in the request. Monitoring never calls this service.
 */

export interface ActionServiceOptions {
  /** Read at call time, so a settings change applies without a restart. */
  readonly enabled: () => boolean;
  readonly registry: ConnectorRegistry;
  readonly connections: ConnectionStore;
  readonly credentials: CredentialStore;
  readonly snapshots: SnapshotStore;
  readonly actions: ActionStore;
  readonly leases: LeaseStore;
  readonly collection: CollectionService;
  readonly leaseTtlMs?: number;
}

export interface PerformActionInput {
  readonly connectionId: string;
  readonly action: AccountActionKind;
  readonly creditId?: string;
  /** Must be true; the browser sets it only after the owner confirmed the named credit. */
  readonly confirm: boolean;
}

export interface ActionOutcome {
  readonly action: AccountActionRow;
  /** The follow-up collection after a success; absent otherwise. */
  readonly collection?: CollectionOutcome;
}

export class ActionsDisabledError extends Error {
  constructor() {
    super("account actions are switched off (HEADROOM_ENABLE_ACTIONS)");
    this.name = "ActionsDisabledError";
  }
}
export class ActionNotConfirmedError extends Error {
  constructor() {
    super("the action was not confirmed");
    this.name = "ActionNotConfirmedError";
  }
}
export class UnsupportedActionError extends Error {
  constructor(
    readonly provider: string,
    readonly action: string,
  ) {
    super(`${provider} does not support ${action}`);
    this.name = "UnsupportedActionError";
  }
}
export class ActionNotAllowedError extends Error {
  constructor(readonly reason: "connection_not_ready" | "credit_not_usable" | "credit_required") {
    super(`action not allowed: ${reason}`);
    this.name = "ActionNotAllowedError";
  }
}

export class ActionService {
  private readonly leaseTtlMs: number;

  constructor(private readonly deps: ActionServiceOptions) {
    this.leaseTtlMs = deps.leaseTtlMs ?? 60_000;
  }

  get enabled(): boolean {
    return this.deps.enabled();
  }

  /** Actions the connector for this provider can perform; empty when it has none. */
  supported(provider: string): readonly AccountActionKind[] {
    const connector = this.deps.registry.list().find((entry) => entry.provider === provider);
    return connector?.performAction ? (connector.supportedActions ?? []) : [];
  }

  async perform(input: PerformActionInput): Promise<ActionOutcome> {
    if (!this.deps.enabled()) throw new ActionsDisabledError();
    if (!input.confirm) throw new ActionNotConfirmedError();
    const connection = this.deps.connections.get(input.connectionId);
    if (!connection) throw new Error("connection not found");
    const connector = this.deps.registry.get(connection.provider);
    const perform = connector?.performAction?.bind(connector);
    if (!connector || !perform || !(connector.supportedActions ?? []).includes(input.action))
      throw new UnsupportedActionError(connection.provider, input.action);
    if (connection.state !== "ready" && connection.state !== "partial")
      throw new ActionNotAllowedError("connection_not_ready");
    const creditId = this.checkCredit(connection.id, input);

    const record = this.deps.credentials.get(connection.id);
    if (!record) throw new Error("connection has no credentials");
    const credential = { secret: record.secret, expiresAt: record.expiresAt };

    const row = this.deps.actions.create(connection.id, input.action);
    let result: ActionResult;
    try {
      result = await this.deps.leases.withLease(
        connection.id,
        `action:${row.id}`,
        this.leaseTtlMs,
        async () => {
          this.deps.actions.markSubmitted(row.id);
          try {
            return await perform(credential, {
              action: input.action,
              creditId,
              idempotencyKey: row.idempotencyKey,
            });
          } catch (error) {
            // The request may have left; nothing proves whether it applied.
            return { status: "uncertain", error: connector.classify(error) };
          }
        },
      );
    } catch (error) {
      if (error instanceof LeaseHeldError) {
        const failed = this.deps.actions.complete(row.id, "failed", {
          sanitizedError: "another operation holds this connection; nothing was sent",
        });
        return { action: failed };
      }
      throw error;
    }

    switch (result.status) {
      case "succeeded": {
        const collection = await this.deps.collection.run(connection.id, `action:${row.id}`);
        const snapshotId = this.deps.snapshots.latest(connection.id)?.snapshot.id ?? null;
        const done = this.deps.actions.complete(row.id, "succeeded", {
          providerReference: result.providerReference,
          resultingSnapshotId: snapshotId,
        });
        return { action: done, collection };
      }
      case "failed":
        return {
          action: this.deps.actions.complete(row.id, "failed", {
            sanitizedError: `${result.error.category}: ${result.error.message}`,
          }),
        };
      case "uncertain":
        return {
          action: this.deps.actions.complete(row.id, "uncertain", {
            sanitizedError: `${result.error.category}: ${result.error.message}`,
          }),
        };
      default:
        return assertNever(result);
    }
  }

  /**
   * The credit must be in the latest snapshot and usable. Every action kind today names a credit;
   * an action without one returns null here when such a kind is added.
   */
  private checkCredit(connectionId: string, input: PerformActionInput): string | null {
    if (!input.creditId) throw new ActionNotAllowedError("credit_required");
    const latest = this.deps.snapshots.latest(connectionId);
    const credit = latest?.resetCredits.find((c) => c.providerCreditId === input.creditId);
    if (!credit?.usable) throw new ActionNotAllowedError("credit_not_usable");
    return credit.providerCreditId;
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${String(value)}`);
}
