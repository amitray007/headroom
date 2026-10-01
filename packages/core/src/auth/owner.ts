import { createHash, randomBytes } from "node:crypto";

import { eq, lt } from "drizzle-orm";

import { type Db, schema } from "../db/index.ts";

/**
 * Single-owner authentication: one password hashed with argon2id, and
 * opaque session tokens stored as SHA-256 hashes. See docs/architecture/deployment.md.
 */

export const minimumPasswordLength = 12;
export const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;

export class OwnerStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  hasOwner(): boolean {
    return this.db.select({ id: schema.owner.id }).from(schema.owner).get() !== undefined;
  }

  /** Create the single owner. Fails if one exists or the password is too short. */
  async bootstrap(password: string): Promise<{ ownerId: string }> {
    if (this.hasOwner()) throw new OwnerExistsError();
    assertPassword(password);
    const ownerId = Bun.randomUUIDv7();
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    this.db.insert(schema.owner).values({ id: ownerId, passwordHash, createdAt: this.now() }).run();
    return { ownerId };
  }

  /** Returns the owner id on success, null on a wrong password or no owner. */
  async verifyPassword(password: string): Promise<string | null> {
    const row = this.db.select().from(schema.owner).get();
    if (!row) return null;
    return (await Bun.password.verify(password, row.passwordHash)) ? row.id : null;
  }

  async changePassword(current: string, next: string): Promise<boolean> {
    const ownerId = await this.verifyPassword(current);
    if (!ownerId) return false;
    assertPassword(next);
    const passwordHash = await Bun.password.hash(next, { algorithm: "argon2id" });
    this.db.update(schema.owner).set({ passwordHash }).where(eq(schema.owner.id, ownerId)).run();
    this.db.delete(schema.sessions).where(eq(schema.sessions.ownerId, ownerId)).run();
    return true;
  }

  /** Issue a session. The returned token goes into the cookie; only its hash is stored. */
  createSession(ownerId: string): { token: string; expiresAt: Date } {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + sessionTtlMs);
    this.db
      .insert(schema.sessions)
      .values({ tokenHash: hashToken(token), ownerId, createdAt: this.now(), expiresAt })
      .run();
    return { token, expiresAt };
  }

  /** Validate a cookie token; slides expiry forward when past half its life. */
  validateSession(token: string): { ownerId: string } | null {
    const tokenHash = hashToken(token);
    const row = this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.tokenHash, tokenHash))
      .get();
    if (!row) return null;
    const now = this.now();
    if (row.expiresAt.getTime() <= now.getTime()) {
      this.db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash)).run();
      return null;
    }
    if (row.expiresAt.getTime() - now.getTime() < sessionTtlMs / 2) {
      this.db
        .update(schema.sessions)
        .set({ expiresAt: new Date(now.getTime() + sessionTtlMs) })
        .where(eq(schema.sessions.tokenHash, tokenHash))
        .run();
    }
    return { ownerId: row.ownerId };
  }

  revokeSession(token: string): void {
    this.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.tokenHash, hashToken(token)))
      .run();
  }

  purgeExpiredSessions(): number {
    return this.db
      .delete(schema.sessions)
      .where(lt(schema.sessions.expiresAt, this.now()))
      .returning({ tokenHash: schema.sessions.tokenHash })
      .all().length;
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function assertPassword(password: string): void {
  if (password.length < minimumPasswordLength) throw new WeakPasswordError();
}

export class OwnerExistsError extends Error {
  constructor() {
    super("an owner already exists");
    this.name = "OwnerExistsError";
  }
}

export class WeakPasswordError extends Error {
  constructor() {
    super(`password must be at least ${minimumPasswordLength} characters`);
    this.name = "WeakPasswordError";
  }
}
