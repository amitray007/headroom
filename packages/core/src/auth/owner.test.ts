import { describe, expect, test } from "bun:test";

import { openDatabase, schema } from "../db/index.ts";
import { OwnerExistsError, OwnerStore, sessionTtlMs, WeakPasswordError } from "./owner.ts";

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

function setup() {
  const { db } = openDatabase({ path: ":memory:" });
  let now = 1_700_000_000_000;
  const store = new OwnerStore(db, () => new Date(now));
  return { db, store, advance: (ms: number) => (now += ms) };
}

describe("OwnerStore", () => {
  test("bootstrap once, then verify", async () => {
    const { store } = setup();
    expect(store.hasOwner()).toBe(false);
    const { ownerId } = await store.bootstrap("correct horse battery");
    expect(store.hasOwner()).toBe(true);
    expect(await store.verifyPassword("correct horse battery")).toBe(ownerId);
    expect(await store.verifyPassword("wrong")).toBeNull();
    expect(await rejection(store.bootstrap("another long password"))).toBeInstanceOf(
      OwnerExistsError,
    );
  });

  test("rejects short passwords", async () => {
    const { store } = setup();
    expect(await rejection(store.bootstrap("short"))).toBeInstanceOf(WeakPasswordError);
  });

  test("sessions store only a hash, expire, and slide", async () => {
    const { db, store, advance } = setup();
    const { ownerId } = await store.bootstrap("correct horse battery");
    const { token } = store.createSession(ownerId);
    const rows = db.select().from(schema.sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(token);
    expect(store.validateSession(token)).toEqual({ ownerId });
    expect(store.validateSession("nope")).toBeNull();
    advance(sessionTtlMs * 0.6);
    const before = db.select().from(schema.sessions).get()?.expiresAt.getTime() ?? 0;
    expect(store.validateSession(token)).toEqual({ ownerId });
    const after = db.select().from(schema.sessions).get()?.expiresAt.getTime() ?? 0;
    expect(after).toBeGreaterThan(before);
    advance(sessionTtlMs + 1);
    expect(store.validateSession(token)).toBeNull();
    expect(db.select().from(schema.sessions).all()).toHaveLength(0);
  });

  test("revoke, purge and password change invalidate sessions", async () => {
    const { store, advance } = setup();
    const { ownerId } = await store.bootstrap("correct horse battery");
    const a = store.createSession(ownerId);
    const b = store.createSession(ownerId);
    store.revokeSession(a.token);
    expect(store.validateSession(a.token)).toBeNull();
    expect(store.validateSession(b.token)).not.toBeNull();
    expect(await store.changePassword("wrong", "new long password here")).toBe(false);
    expect(await store.changePassword("correct horse battery", "new long password here")).toBe(
      true,
    );
    expect(store.validateSession(b.token)).toBeNull();
    const c = store.createSession(ownerId);
    advance(sessionTtlMs + 1);
    expect(store.purgeExpiredSessions()).toBe(1);
    expect(store.validateSession(c.token)).toBeNull();
  });
});
