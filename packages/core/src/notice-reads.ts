import { inArray, lt } from "drizzle-orm";

import { type Db, schema } from "./db/index.ts";

/**
 * Which notices the owner has read. One owner, one set. A notice id changes with each period, so
 * a mark older than this names a notice that no longer exists and a write removes it.
 */
export const noticeReadRetentionMs = 90 * 86_400_000;

export class NoticeReadStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every id marked read, sorted. */
  list(): string[] {
    return this.db
      .select({ id: schema.noticeReads.noticeId })
      .from(schema.noticeReads)
      .all()
      .map((row) => row.id)
      .toSorted();
  }

  /** Mark ids read or unread, drop marks past retention, and return the whole set. */
  mark(ids: readonly string[], read: boolean): string[] {
    const unique = [...new Set(ids)];
    const at = this.now();
    this.db.transaction((tx) => {
      if (unique.length > 0 && read) {
        tx.insert(schema.noticeReads)
          .values(unique.map((noticeId) => ({ noticeId, readAt: at })))
          .onConflictDoNothing()
          .run();
      } else if (unique.length > 0) {
        tx.delete(schema.noticeReads).where(inArray(schema.noticeReads.noticeId, unique)).run();
      }
      tx.delete(schema.noticeReads)
        .where(lt(schema.noticeReads.readAt, new Date(at.getTime() - noticeReadRetentionMs)))
        .run();
    });
    return this.list();
  }
}
