import { describe, expect, test } from "bun:test";

import { emptyBook, type WalletBook } from "@headroom/view-model/wallet";

import {
  amountText,
  dayLabel,
  dayOf,
  effectiveCurrency,
  monthLabel,
  parseAmount,
  parsePositive,
  usedCurrencies,
  withCost,
  withDisplay,
  withRate,
  withTopUp,
  withoutTopUp,
} from "./book.ts";

const paid = (minor: number, currency: "USD" | "EUR" | "INR") =>
  ({
    kind: "paid",
    price: { minor, currency },
    cycle: "monthly",
    renewsOn: null,
  }) as const;

describe("currencies in use", () => {
  test("none in use leaves the owner's choice", () => {
    expect(usedCurrencies(emptyBook)).toEqual([]);
    expect(effectiveCurrency(withDisplay(emptyBook, "GBP"))).toBe("GBP");
  });
  test("one in use is the display currency", () => {
    const book = withDisplay(withCost(emptyBook, "a", paid(199900, "INR")), "USD");
    expect(usedCurrencies(book)).toEqual(["INR"]);
    expect(effectiveCurrency(book)).toBe("INR");
  });
  test("several in use keep the choice when it is among them", () => {
    let book: WalletBook = withCost(emptyBook, "a", paid(1000, "EUR"));
    book = withCost(book, "b", paid(2000, "USD"));
    expect(usedCurrencies(book)).toEqual(["USD", "EUR"]);
    expect(effectiveCurrency(withDisplay(book, "EUR"))).toBe("EUR");
    expect(effectiveCurrency(withDisplay(book, "INR"))).toBe("USD");
  });
  test("a top-up price counts too", () => {
    const book = withTopUp(emptyBook, {
      id: "t",
      connectionId: "a",
      date: "2026-10-01",
      kind: "paid",
      price: { minor: 500, currency: "EUR" },
      credits: null,
      note: null,
    });
    expect(usedCurrencies(book)).toEqual(["EUR"]);
    expect(withoutTopUp(book, "t").topUps).toEqual([]);
  });
});

describe("edits", () => {
  test("a cost is set and cleared by connection id", () => {
    const set = withCost(emptyBook, "a", { kind: "free" });
    expect(set.costs["a"]).toEqual({ kind: "free" });
    expect(withCost(set, "a", null).costs).toEqual({});
    expect(emptyBook.costs).toEqual({});
  });
  test("a rate is set and cleared, and USD stays 1", () => {
    const set = withRate(emptyBook, "INR", 83.5);
    expect(set.perUsd).toEqual({ USD: 1, INR: 83.5 });
    expect(withRate(set, "INR", null).perUsd).toEqual({ USD: 1 });
    expect(withRate(set, "USD", 2)).toBe(set);
  });
});

describe("typed numbers", () => {
  test("an amount is digits with up to two decimals above zero", () => {
    expect(parseAmount("200")).toBe(20000);
    expect(parseAmount(" 199.99 ")).toBe(19999);
    expect(parseAmount("0.5")).toBe(50);
    for (const bad of ["", "0", "0.00", "-5", "1,999", "12.345", "abc", "1e3"]) {
      expect(parseAmount(bad)).toBeNull();
    }
  });
  test("rates and credits are numbers above zero", () => {
    expect(parsePositive("83.5")).toBe(83.5);
    expect(parsePositive("1000")).toBe(1000);
    for (const bad of ["", "0", "-1", "x", "1,5"]) expect(parsePositive(bad)).toBeNull();
  });
  test("an amount reads back as an input value", () => {
    expect(amountText(20000)).toBe("200");
    expect(amountText(19999)).toBe("199.99");
    expect(amountText(1050)).toBe("10.50");
  });
});

describe("dates", () => {
  test("a day reads as month and date", () => {
    expect(dayLabel("2026-10-12")).toBe("Oct 12");
    expect(dayLabel("2026-01-05")).toBe("Jan 5");
    expect(dayLabel("soon")).toBe("soon");
  });
  test("a month reads with its year", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(monthLabel("later")).toBe("later");
  });
  test("a moment is its local day", () => {
    expect(dayOf(new Date(2026, 9, 3, 23, 30).getTime())).toBe("2026-10-03");
    expect(dayOf(new Date(2026, 0, 9, 0, 5).getTime())).toBe("2026-01-09");
  });
});
