import { describe, expect, test } from "bun:test";

import { decodeJwt, expiryOf, parseDate } from "./connector-util.ts";

const jwt = (claims: unknown) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

describe("connector utilities", () => {
  test("decodeJwt reads the payload and returns null for anything else", () => {
    expect(decodeJwt(jwt({ sub: "u1" }))).toEqual({ sub: "u1" });
    expect(decodeJwt("not-a-jwt")).toBeNull();
    expect(decodeJwt("a.@@@.c")).toBeNull();
  });

  test("expiryOf returns the exp claim in milliseconds or null", () => {
    expect(expiryOf(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
    expect(expiryOf(jwt({ sub: "u1" }))).toBeNull();
    expect(expiryOf(jwt({ exp: "soon" }))).toBeNull();
    expect(expiryOf("opaque")).toBeNull();
  });

  test("parseDate reads ISO strings and treats junk as null", () => {
    expect(parseDate("2026-10-01T00:00:00Z")).toBe(Date.parse("2026-10-01T00:00:00Z"));
    expect(parseDate("nope")).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});
