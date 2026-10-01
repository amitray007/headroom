import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import { migrationFiles } from "./migrations/index.ts";
import * as schema from "./schema.ts";

export type Db = BunSQLiteDatabase<typeof schema>;
export { schema };

export interface OpenDatabaseOptions {
  /** File path, or ":memory:" for tests. */
  readonly path: string;
}

/**
 * Open SQLite with the pragmas the deployment doc requires, then apply any
 * migration not yet recorded in headroom_migrations. Safe to call on every start.
 */
export function openDatabase(options: OpenDatabaseOptions): { db: Db; sqlite: Database } {
  const sqlite = new Database(options.path, { create: true, strict: true });
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA busy_timeout = 5000");
  sqlite.run("PRAGMA synchronous = NORMAL");
  applyMigrations(sqlite);
  return { db: drizzle(sqlite, { schema }), sqlite };
}

function applyMigrations(sqlite: Database): void {
  sqlite.run(
    "CREATE TABLE IF NOT EXISTS headroom_migrations (name text PRIMARY KEY NOT NULL, applied_at integer NOT NULL DEFAULT (unixepoch('subsec') * 1000))",
  );
  const applied = new Set(
    sqlite
      .query<{ name: string }, []>("SELECT name FROM headroom_migrations")
      .all()
      .map((row) => row.name),
  );
  for (const migration of migrationFiles) {
    if (applied.has(migration.name)) continue;
    sqlite.transaction(() => {
      for (const statement of migration.sql.split("--> statement-breakpoint")) {
        const trimmed = statement.trim();
        if (trimmed.length > 0) sqlite.run(trimmed);
      }
      sqlite.run("INSERT INTO headroom_migrations (name) VALUES (?)", [migration.name]);
    })();
  }
}

/** Names of applied migrations, oldest first. */
export function appliedMigrations(sqlite: Database): string[] {
  return sqlite
    .query<{ name: string }, []>("SELECT name FROM headroom_migrations ORDER BY applied_at, name")
    .all()
    .map((row) => row.name);
}
