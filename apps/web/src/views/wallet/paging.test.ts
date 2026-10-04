import { describe, expect, test } from "bun:test";

import { keepsCount, nextCount, pageSize } from "./paging.ts";

describe("top-up paging", () => {
  test("steps by a page and stops at the total", () => {
    expect(nextCount(pageSize, 120)).toBe(100);
    expect(nextCount(100, 120)).toBe(120);
    expect(nextCount(120, 120)).toBe(120);
    expect(nextCount(pageSize, 10)).toBe(10);
  });

  test("keeps the count when one top-up is added, edited or removed", () => {
    expect(keepsCount(["a", "b", "c"], ["n", "a", "b", "c"])).toBe(true);
    expect(keepsCount(["a", "b", "c"], ["a", "c"])).toBe(true);
  });

  test("starts over when the list shares no top-up with the last one", () => {
    expect(keepsCount(["a", "b"], ["x", "y"])).toBe(false);
  });

  test("an empty list on either side keeps the count", () => {
    expect(keepsCount([], ["a"])).toBe(true);
    expect(keepsCount(["a"], [])).toBe(true);
  });
});
