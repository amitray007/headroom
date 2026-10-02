import { describe, expect, test } from "bun:test";

import { generateSecret } from "./secret.ts";

describe("generateSecret", () => {
  test("is whsec_ plus 32 base64 characters", () => {
    expect(generateSecret()).toMatch(/^whsec_[A-Za-z0-9+/]{32}$/);
  });
  test("encodes the bytes it was given", () => {
    const secret = generateSecret((bytes) => bytes.fill(0xff));
    expect(secret).toBe(`whsec_${"/".repeat(32)}`);
  });
  test("differs between calls", () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});
