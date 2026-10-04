import { lt, sql } from "drizzle-orm";

import {
  accountEventDetailSchema,
  accountEventSchema,
  type AccountEvent,
  type AccountEventDetail,
} from "./automation-schemas.ts";
import { type Db, schema } from "./db/index.ts";

/**
 * Rows in `account_events`: what Headroom noticed between two readings, or an automation it ran
 * (ADR 0003). The detail holds numbers and ids only. Pruned with sync history.
 */

interface EventRow {
  id: string;
  connection_id: string;
  occurred_at: number;
  metric_key: string | null;
  detail_json: string;
}

export class AccountEventStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The kind column is the detail's kind, so the two cannot disagree. */
  record(
    connectionId: string,
    occurredAt: number,
    metricKey: string | null,
    detail: AccountEventDetail,
  ): AccountEvent {
    const valid = accountEventDetailSchema.parse(detail);
    const id = Bun.randomUUIDv7();
    this.db
      .insert(schema.accountEvents)
      .values({
        id,
        connectionId,
        kind: valid.kind,
        occurredAt: new Date(occurredAt),
        metricKey,
        detailJson: JSON.stringify(valid),
      })
      .run();
    return { id, connectionId, occurredAt, metricKey, detail: valid };
  }

  /**
   * Events at or after `since`, newest first, at most `perConnectionLimit` for each account.
   * One statement for every account. A row that no longer parses is skipped.
   */
  recent(since: Date, perConnectionLimit = 20): AccountEvent[] {
    const rows = this.db.all<EventRow>(sql`
      SELECT id, connection_id, occurred_at, metric_key, detail_json FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY connection_id ORDER BY occurred_at DESC, id DESC
        ) AS position
        FROM account_events WHERE occurred_at >= ${since.getTime()}
      ) WHERE position <= ${perConnectionLimit}
      ORDER BY occurred_at DESC, id DESC`);
    return rows.flatMap((row) => {
      let detail: unknown;
      try {
        detail = JSON.parse(row.detail_json);
      } catch {
        return [];
      }
      const parsed = accountEventSchema.safeParse({
        id: row.id,
        connectionId: row.connection_id,
        occurredAt: row.occurred_at,
        metricKey: row.metric_key,
        detail,
      });
      return parsed.success ? [parsed.data] : [];
    });
  }

  /** Delete events older than `cutoff`. Returns how many. */
  prune(cutoff: Date): number {
    return this.db
      .delete(schema.accountEvents)
      .where(lt(schema.accountEvents.occurredAt, cutoff))
      .returning({ id: schema.accountEvents.id })
      .all().length;
  }
}
