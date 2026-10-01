import { desc, eq } from "drizzle-orm";

import type { Db } from "./db/index.ts";
import * as schema from "./db/schema.ts";
import type { AccountActionKind, AccountActionState } from "./enums.ts";

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

  create(connectionId: string, action: AccountActionKind): AccountActionRow {
    const id = Bun.randomUUIDv7();
    return this.db
      .insert(schema.accountActions)
      .values({
        id,
        connectionId,
        action,
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
}
