import { and, desc, eq, gte, inArray, or } from "drizzle-orm";

import type { Db } from "./db/index.ts";
import * as schema from "./db/schema.ts";
import type { AccountActionKind, AccountActionOrigin, AccountActionState } from "./enums.ts";

/**
 * Rows in `account_actions`: one per owner-triggered mutation. The row exists before the
 * provider is called, its id is the idempotency key, and it ends `succeeded`, `failed` or
 * `uncertain`. See "Actions" in docs/architecture/data-model.md.
 */

export type AccountActionRow = typeof schema.accountActions.$inferSelect;

export class ActionStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(
    connectionId: string,
    action: AccountActionKind,
    origin: AccountActionOrigin = "owner",
  ): AccountActionRow {
    const id = Bun.randomUUIDv7();
    return this.db
      .insert(schema.accountActions)
      .values({
        id,
        connectionId,
        action,
        origin,
        idempotencyKey: id,
        state: "requested",
        requestedAt: this.now(),
      })
      .returning()
      .get();
  }

  markSubmitted(id: string): void {
    this.db
      .update(schema.accountActions)
      .set({ state: "submitted" })
      .where(eq(schema.accountActions.id, id))
      .run();
  }

  complete(
    id: string,
    state: Extract<AccountActionState, "succeeded" | "failed" | "uncertain">,
    outcome: {
      providerReference?: string | null;
      sanitizedError?: string | null;
      resultingSnapshotId?: string | null;
    } = {},
  ): AccountActionRow {
    return this.db
      .update(schema.accountActions)
      .set({
        state,
        completedAt: this.now(),
        providerReference: outcome.providerReference ?? null,
        sanitizedError: outcome.sanitizedError ?? null,
        resultingSnapshotId: outcome.resultingSnapshotId ?? null,
      })
      .where(eq(schema.accountActions.id, id))
      .returning()
      .get();
  }

  get(id: string): AccountActionRow | null {
    return (
      this.db.select().from(schema.accountActions).where(eq(schema.accountActions.id, id)).get() ??
      null
    );
  }

  list(connectionId: string): AccountActionRow[] {
    return this.db
      .select()
      .from(schema.accountActions)
      .where(eq(schema.accountActions.connectionId, connectionId))
      .orderBy(desc(schema.accountActions.requestedAt))
      .all();
  }

  /** Automatic actions for the connection that started at or after `since`, newest first. */
  automaticSince(connectionId: string, since: Date): AccountActionRow[] {
    return this.db
      .select()
      .from(schema.accountActions)
      .where(
        and(
          eq(schema.accountActions.connectionId, connectionId),
          eq(schema.accountActions.origin, "automation"),
          gte(schema.accountActions.requestedAt, since),
        ),
      )
      .orderBy(desc(schema.accountActions.requestedAt))
      .all();
  }

  /**
   * Whether an action could explain a change between two readings: one that started or ended after
   * `since` and did not fail. An action still in flight counts, because the follow-up collection
   * of a successful action runs before the row is marked `succeeded`.
   */
  explainsChangeSince(connectionId: string, since: Date): boolean {
    const row = this.db
      .select({ id: schema.accountActions.id })
      .from(schema.accountActions)
      .where(
        and(
          eq(schema.accountActions.connectionId, connectionId),
          inArray(schema.accountActions.state, [
            "requested",
            "submitted",
            "succeeded",
            "uncertain",
          ]),
          or(
            gte(schema.accountActions.requestedAt, since),
            gte(schema.accountActions.completedAt, since),
          ),
        ),
      )
      .limit(1)
      .get();
    return row !== undefined;
  }
}
