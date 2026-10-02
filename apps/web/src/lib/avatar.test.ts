import { describe, expect, test } from "bun:test";

import { avatarSrc } from "./avatar.ts";

describe("avatarSrc", () => {
  test("seeds the voxel-bot style with the username", () => {
    expect(avatarSrc("amit")).toBe(
      "https://api.dicebear.com/10.x/voxel-bot/svg?tags=animation&seed=amit",
    );
  });
  test("encodes characters that would change the query", () => {
    expect(avatarSrc("a&b c/é")).toContain("seed=a%26b%20c%2F%C3%A9");
  });
});
