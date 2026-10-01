import { describe, expect, test } from "bun:test";

import { CredentialStore } from "./credentials.ts";
import { createKeyring, generateKeyHex, parseKeyHex } from "./crypto/index.ts";
import { openDatabase, schema } from "./db/index.ts";

function setup(keys: Record<number, Uint8Array>) {
  const { db } = openDatabase({ path: ":memory:" });
  for (const id of ["c1", "c2"]) {
    db.insert(schema.connections)
      .values({
        id,
        provider: "codex",
        providerAccountId: `acct-${id}`,
        scope: "individual",
        label: id,
        authMethod: "cli_login",
        state: "ready",
        interface: "private",
        connectorVersion: "0.0.0",
      })
      .run();
  }
  return { db, store: new CredentialStore(db, createKeyring(keys)) };
}

const k1 = parseKeyHex(generateKeyHex());
const k2 = parseKeyHex(generateKeyHex());

describe("CredentialStore", () => {
  test("put, get, replace, delete", () => {
    const { store } = setup({ 1: k1 });
    store.put("c1", { secret: { access: "a", refresh: "r" }, expiresAt: 1_700_000_000_000 });
    const got = store.get("c1");
    expect(got?.secret).toEqual({ access: "a", refresh: "r" });
    expect(got?.expiresAt).toBe(1_700_000_000_000);
    expect(got?.refreshState).toBe("fresh");
    store.put("c1", { secret: { access: "a2", refresh: "r2" }, expiresAt: null }, "refresh_due");
    expect(store.get("c1")?.secret).toEqual({ access: "a2", refresh: "r2" });
    expect(store.get("c1")?.refreshState).toBe("refresh_due");
    store.delete("c1");
    expect(store.get("c1")).toBeNull();
  });

  test("ciphertext is bound to its connection and never stored in plaintext", () => {
    const { db, store } = setup({ 1: k1 });
    store.put("c1", { secret: { access: "topsecret" }, expiresAt: null });
    const row = db.select().from(schema.credentials).all()[0];
    expect(Buffer.from(row?.ciphertext ?? "").toString("utf8")).not.toContain("topsecret");
    // Move c1's ciphertext onto c2 and try to read it as c2.
    db.insert(schema.credentials)
      .values({ ...row!, connectionId: "c2" })
      .run();
    expect(() => store.get("c2")).toThrow();
  });

  test("rotation re-seals under the current key and old rows still open", () => {
    const { db, store } = setup({ 1: k1 });
    store.put("c1", { secret: { access: "a" }, expiresAt: null });
    store.put("c2", { secret: { access: "b" }, expiresAt: null });
    const rotated = new CredentialStore(db, createKeyring({ 1: k1, 2: k2 }));
    expect(rotated.get("c1")?.keyVersion).toBe(1);
    expect(rotated.rotate()).toBe(2);
    expect(rotated.get("c1")?.keyVersion).toBe(2);
    expect(rotated.get("c2")?.secret).toEqual({ access: "b" });
    expect(rotated.rotate()).toBe(0);
  });
});
