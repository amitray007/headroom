import { describe, expect, test } from "bun:test";

import { breakParts } from "./breakable.tsx";

describe("breakParts", () => {
  test("splits an email after @ and before each dot", () => {
    expect(breakParts("owner@inbox.example.com")).toEqual(["owner@", "inbox", ".example", ".com"]);
    expect(breakParts("first.last@example.com")).toEqual(["first", ".last@", "example", ".com"]);
  });

  test("keeps text without break points whole", () => {
    expect(breakParts("owner")).toEqual(["owner"]);
    expect(breakParts("")).toEqual([""]);
  });

  test("the parts join back to the same text", () => {
    const text = "a.b@c.d.e";
    expect(breakParts(text).join("")).toBe(text);
  });
});
