import { describe, expect, test } from "bun:test";

import { emptyBook } from "@headroom/view-model/wallet";

import { newId, withCost, withDisplay, withRate, withTopUp, withoutTopUp } from "./book.ts";

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

  test("a rate is set and cleared, notes the day, and USD stays 1", () => {
    const set = withRate(emptyBook, "INR", 83.5, "2026-10-04");
    expect(set.perUsd).toEqual({ USD: 1, INR: 83.5 });
    expect(set.ratesChangedOn).toBe("2026-10-04");
    const cleared = withRate(set, "INR", null, "2026-10-05");
    expect(cleared.perUsd).toEqual({ USD: 1 });
    expect(cleared.ratesChangedOn).toBe("2026-10-05");
    expect(withRate(set, "USD", 2, "2026-10-06")).toBe(set);
    expect(emptyBook.ratesChangedOn).toBeNull();
  });

  test("the display currency is stored in the book", () => {
    expect(withDisplay(emptyBook, "JPY").displayCurrency).toBe("JPY");
    expect(emptyBook.displayCurrency).toBeNull();
  });

  test("new ids differ", () => {
    expect(newId()).not.toBe(newId());
  });
});
