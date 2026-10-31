import { and, eq } from "drizzle-orm";

import { type Db, schema } from "./db/index.ts";
import { type ApiTokenScope, apiTokenScopeSchema } from "./enums.ts";

/**
 * The app scopes stored in `apikey.permissions` (`{"app":["read","refresh"]}`). Anything
 * unreadable counts as read-only, so a damaged row can never gain a scope.
 */
export function apiTokenScopesOf(permissions: unknown): ApiTokenScope[] {
  let value = permissions;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return ["read"];
    }
  }
  const app =
    typeof value === "object" && value !== null ? (value as { app?: unknown }).app : undefined;
  const scopes = Array.isArray(app)
    ? app.flatMap((scope) => {
        const parsed = apiTokenScopeSchema.safeParse(scope);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  return scopes.includes("read") ? scopes : ["read"];
}

/** An explicit projection prevents even a hashed key from entering a management response. */
export class ApiTokenStore {
  constructor(private readonly db: Db) {}

  list(ownerId: string) {
    const rows = this.db
      .select({
        id: schema.apikey.id,
        name: schema.apikey.name,
        prefix: schema.apikey.prefix,
        start: schema.apikey.start,
        createdAt: schema.apikey.createdAt,
        lastUsedAt: schema.apikey.lastRequest,
        expiresAt: schema.apikey.expiresAt,
        permissions: schema.apikey.permissions,
      })
      .from(schema.apikey)
      .where(eq(schema.apikey.referenceId, ownerId))
      .all();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      start: row.start,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      scopes: apiTokenScopesOf(row.permissions),
    }));
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
