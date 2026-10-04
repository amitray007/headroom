import { and, desc, eq, lt } from "drizzle-orm";

import { type Db, schema } from "../db/index.ts";
import type { NotificationDeliveryFailure, NotificationDeliveryStatus } from "../enums.ts";

/** The dedupe record and retry state for one event on one channel. Holds no credential and no response body. */

export interface DeliveryRow {
  readonly channelId: string;
  readonly eventId: string;
  readonly kind: string;
  readonly status: NotificationDeliveryStatus;
  readonly attempts: number;
  readonly failure: NotificationDeliveryFailure | null;
  readonly firstAttemptAt: Date;
  readonly lastAttemptAt: Date;
  readonly nextAttemptAt: Date | null;
  readonly deliveredAt: Date | null;
}

export interface AttemptRecord {
  readonly channelId: string;
  readonly eventId: string;
  readonly kind: string;
  readonly status: NotificationDeliveryStatus;
  readonly attempts: number;
  readonly failure: NotificationDeliveryFailure | null;
  readonly at: Date;
  readonly nextAttemptAt: Date | null;
}

export interface LastDelivery {
  readonly status: NotificationDeliveryStatus;
  readonly at: Date;
  readonly failure: NotificationDeliveryFailure | null;
}

export class DeliveryStore {
  constructor(private readonly db: Db) {}

  get(channelId: string, eventId: string): DeliveryRow | null {
    return (
      this.db
        .select()
        .from(schema.notificationDeliveries)
        .where(
          and(
            eq(schema.notificationDeliveries.channelId, channelId),
            eq(schema.notificationDeliveries.eventId, eventId),
          ),
        )
        .get() ?? null
    );
  }

  /** Insert the first attempt, or update the row for a later one. */
  recordAttempt(attempt: AttemptRecord): void {
    const delivered = attempt.status === "delivered" ? attempt.at : null;
    this.db
      .insert(schema.notificationDeliveries)
      .values({
        channelId: attempt.channelId,
        eventId: attempt.eventId,
        kind: attempt.kind,
        status: attempt.status,
        attempts: attempt.attempts,
        failure: attempt.failure,
        firstAttemptAt: attempt.at,
        lastAttemptAt: attempt.at,
        nextAttemptAt: attempt.nextAttemptAt,
        deliveredAt: delivered,
      })
      .onConflictDoUpdate({
        target: [schema.notificationDeliveries.channelId, schema.notificationDeliveries.eventId],
        set: {
          status: attempt.status,
          attempts: attempt.attempts,
          failure: attempt.failure,
          lastAttemptAt: attempt.at,
          nextAttemptAt: attempt.nextAttemptAt,
          deliveredAt: delivered,
        },
      })
      .run();
  }

  /** The most recent attempt on the channel, or null when it never sent. */
  lastDelivery(channelId: string): LastDelivery | null {
    const row = this.db
      .select()
      .from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.channelId, channelId))
      .orderBy(desc(schema.notificationDeliveries.lastAttemptAt))
      .limit(1)
      .get();
    return row ? { status: row.status, at: row.lastAttemptAt, failure: row.failure } : null;
  }

  /** Delete records whose last attempt is older than the cutoff. Returns the count. */
  prune(olderThan: Date): number {
    return this.db
      .delete(schema.notificationDeliveries)
      .where(lt(schema.notificationDeliveries.lastAttemptAt, olderThan))
      .returning({ id: schema.notificationDeliveries.eventId })
      .all().length;
  }
}
