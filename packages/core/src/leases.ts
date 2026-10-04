import { and, eq, lt, or } from "drizzle-orm";

import { type Db, schema } from "./db/index.ts";

/**
 * Per-connection lease guarding login, refresh, collection and actions.
 * Acquisition is a single conditional write, so two workers cannot both win.
 */
export class LeaseStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Returns true when `holder` now owns the lease until `now + ttlMs`. */
  acquire(connectionId: string, holder: string, ttlMs: number): boolean {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const inserted = this.db
      .insert(schema.leases)
      .values({ connectionId, holder, acquiredAt: now, expiresAt })
      .onConflictDoNothing()
      .returning({ connectionId: schema.leases.connectionId })
      .all();
    if (inserted.length > 0) return true;
    const taken = this.db
      .update(schema.leases)
      .set({ holder, acquiredAt: now, expiresAt })
      .where(
        and(
          eq(schema.leases.connectionId, connectionId),
          or(eq(schema.leases.holder, holder), lt(schema.leases.expiresAt, now)),
        ),
      )
      .returning({ connectionId: schema.leases.connectionId })
      .all();
    return taken.length > 0;
  }

  /** Extend a lease the caller still holds. Returns false if it was lost. */
  renew(connectionId: string, holder: string, ttlMs: number): boolean {
    const now = this.now();
    const result = this.db
      .update(schema.leases)
      .set({ expiresAt: new Date(now.getTime() + ttlMs) })
      .where(and(eq(schema.leases.connectionId, connectionId), eq(schema.leases.holder, holder)))
      .returning({ connectionId: schema.leases.connectionId })
      .all();
    return result.length > 0;
  }

  release(connectionId: string, holder: string): void {
    this.db
      .delete(schema.leases)
      .where(and(eq(schema.leases.connectionId, connectionId), eq(schema.leases.holder, holder)))
      .run();
  }

  /**
   * Poll for the lease until `waitMs` has passed. For work that must not overlap a collection
   * but may wait for one to end. Returns false if it stayed held.
   */
  async acquireWithin(
    connectionId: string,
    holder: string,
    ttlMs: number,
    waitMs: number,
    pollMs = 250,
  ): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    while (!this.acquire(connectionId, holder, ttlMs)) {
      if (Date.now() >= deadline) return false;
      // eslint-disable-next-line no-await-in-loop -- polling for another holder to finish
      await Bun.sleep(pollMs);
    }
    return true;
  }

  /** Run `fn` while holding the lease; release afterwards. Throws if the lease is taken. */
  async withLease<T>(
    connectionId: string,
    holder: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!this.acquire(connectionId, holder, ttlMs)) throw new LeaseHeldError(connectionId);
    try {
      return await fn();
    } finally {
      this.release(connectionId, holder);
    }
  }
}

export class LeaseHeldError extends Error {
  constructor(readonly connectionId: string) {
    super(`lease for connection ${connectionId} is held`);
    this.name = "LeaseHeldError";
  }
}
