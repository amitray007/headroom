import { describe, expect, test } from "bun:test";

import {
  createKeyring,
  generateKeyHex,
  open,
  openJson,
  parseKeyHex,
  seal,
  sealJson,
} from "./index.ts";

const k1 = parseKeyHex(generateKeyHex());
const k2 = parseKeyHex(generateKeyHex());

describe("seal and open", () => {
  test("round-trips and uses the current key version", () => {
    const ring = createKeyring({ 1: k1 });
    const sealed = seal(ring, Buffer.from("secret"), "credentials:c1");
    expect(sealed.keyVersion).toBe(1);
    expect(Buffer.from(open(ring, sealed, "credentials:c1")).toString()).toBe("secret");
  });

  test("a different nonce every time", () => {
    const ring = createKeyring({ 1: k1 });
    const a = seal(ring, Buffer.from("x"), "aad");
    const b = seal(ring, Buffer.from("x"), "aad");
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  test("wrong aad, tampered ciphertext and wrong key all fail", () => {
    const ring = createKeyring({ 1: k1 });
    const sealed = seal(ring, Buffer.from("secret"), "credentials:c1");
    expect(() => open(ring, sealed, "credentials:c2")).toThrow();
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(() => open(ring, { ...sealed, ciphertext: tampered }, "credentials:c1")).toThrow();
    expect(() => open(createKeyring({ 1: k2 }), sealed, "credentials:c1")).toThrow();
  });

  test("rotation: old versions still open, new version seals", () => {
    const old = createKeyring({ 1: k1 });
    const sealedV1 = seal(old, Buffer.from("secret"), "aad");
    const rotated = createKeyring({ 1: k1, 2: k2 });
    expect(rotated.currentVersion).toBe(2);
    expect(Buffer.from(open(rotated, sealedV1, "aad")).toString()).toBe("secret");
    expect(seal(rotated, Buffer.from("x"), "aad").keyVersion).toBe(2);
    expect(() => open(createKeyring({ 2: k2 }), sealedV1, "aad")).toThrow(/no key for version 1/);
  });

  test("json helpers", () => {
    const ring = createKeyring({ 1: k1 });
    const sealed = sealJson(ring, { access: "a", refresh: "r" }, "aad");
    expect(openJson(ring, sealed, "aad")).toEqual({ access: "a", refresh: "r" });
  });
});

describe("key file parsing", () => {
  test("accepts 64 hex characters with whitespace", () => {
    expect(parseKeyHex(`  ${generateKeyHex()}\n`)).toHaveLength(32);
  });
  test("rejects short, long and non-hex input", () => {
    expect(() => parseKeyHex("abc")).toThrow();
    expect(() => parseKeyHex("zz".repeat(32))).toThrow();
    expect(() => createKeyring({ 1: new Uint8Array(16) })).toThrow(/32 bytes/);
    expect(() => createKeyring({ 0: k1 })).toThrow(/invalid key version/);
  });
});
