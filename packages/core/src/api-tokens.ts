import { and, eq } from "drizzle-orm";

import { type Db, schema } from "./db/index.ts";

/** An explicit projection prevents even a hashed key from entering a management response. */
export class ApiTokenStore {
  constructor(private readonly db: Db) {}

  list(ownerId: string) {
    return this.db
      .select({
        id: schema.apikey.id,
        name: schema.apikey.name,
        prefix: schema.apikey.prefix,
        start: schema.apikey.start,
        createdAt: schema.apikey.createdAt,
        lastUsedAt: schema.apikey.lastRequest,
        expiresAt: schema.apikey.expiresAt,
      })
      .from(schema.apikey)
      .where(eq(schema.apikey.referenceId, ownerId))
      .all();
  }

  /** Database storage has no key cache: deletion invalidates the next verification. */
  revoke(ownerId: string, id: string): boolean {
    return (
      this.db
        .delete(schema.apikey)
        .where(and(eq(schema.apikey.id, id), eq(schema.apikey.referenceId, ownerId)))
        .returning({ id: schema.apikey.id })
        .get() !== undefined
    );
  }
}
