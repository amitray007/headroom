import { describe, expect, test } from "bun:test";

import { emptyBook } from "@headroom/view-model/wallet";

import { newId, withCost, withDisplay, withTopUp, withUpdatedTopUp, withoutTopUp } from "./book.ts";

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
      source: "detected",
      expiresOn: null,
      expiryAlertDays: null,
    });
    expect(added.topUps).toHaveLength(1);
    const edited = withUpdatedTopUp(added, "t", {
      date: "2026-10-02",
      kind: "paid",
      price: { minor: 900, currency: "JPY" },
      credits: 30,
      note: "x",
      expiresOn: "2026-12-01",
      expiryAlertDays: 30,
    });
    // The account, the id and the source stay; the editable fields change.
    expect(edited.topUps[0]).toEqual({
      id: "t",
      connectionId: "a",
      source: "detected",
      date: "2026-10-02",
      kind: "paid",
      price: { minor: 900, currency: "JPY" },
      credits: 30,
      note: "x",
      expiresOn: "2026-12-01",
      expiryAlertDays: 30,
    });
    expect(withUpdatedTopUp(added, "other", { ...edited.topUps[0]! }).topUps).toEqual(added.topUps);
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
