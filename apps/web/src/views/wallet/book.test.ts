import { describe, expect, test } from "bun:test";

import { emptyBook } from "@headroom/view-model/wallet";

import { newId, withCost, withDisplay, withTopUp, withoutTopUp } from "./book.ts";

describe("edits", () => {
  test("a cost is set and cleared by connection id", () => {
    const set = withCost(emptyBook, "a", { kind: "free" });
    expect(set.costs["a"]).toEqual({ kind: "free" });
    expect(withCost(set, "a", null).costs).toEqual({});
    expect(emptyBook.costs).toEqual({});
  });

  test("a top-up is added and removed by id", () => {
    const added = withTopUp(emptyBook, {
      id: "t",
      connectionId: "a",
      date: "2026-10-01",
      kind: "paid",
      price: { minor: 500, currency: "JPY" },
      credits: null,
      note: null,
    });
    expect(added.topUps).toHaveLength(1);
    expect(withoutTopUp(added, "t").topUps).toEqual([]);
  });

  test("the display currency is stored in the book", () => {
    expect(withDisplay(emptyBook, "JPY").displayCurrency).toBe("JPY");
    expect(emptyBook.displayCurrency).toBeNull();
  });

  test("new ids differ", () => {
    expect(newId()).not.toBe(newId());
  });
});
