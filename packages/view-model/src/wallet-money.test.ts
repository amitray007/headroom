import { describe, expect, test } from "bun:test";

import {
  convert,
  currencyName,
  currencySymbol,
  currencies,
  defaultCurrency,
  formatMoney,
  minorDigits,
  missingRate,
  parsePositive,
  toMinor,
  type Money,
} from "./wallet-money.ts";

const usd = (dollars: number): Money => ({ minor: Math.round(dollars * 100), currency: "USD" });
const inr = (rupees: number): Money => ({ minor: rupees * 100, currency: "INR" });
const jpy = (yen: number): Money => ({ minor: yen, currency: "JPY" });

describe("minor units", () => {
  test("digits come from Intl: two for most, none for yen", () => {
    expect(minorDigits("USD")).toBe(2);
    expect(minorDigits("INR")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
  });

  test("major units become minor units by the currency's digits", () => {
    expect(toMinor(19.99, "USD")).toBe(1999);
    expect(toMinor(1500, "JPY")).toBe(1500);
    expect(toMinor(0.1 + 0.2, "USD")).toBe(30);
  });
});

describe("convert", () => {
  const perUsd = { USD: 1, INR: 95, EUR: 0.9, JPY: 150 };

  test("goes through USD in both directions", () => {
    expect(convert(usd(20), "INR", perUsd)).toEqual(inr(1900));
    expect(convert(inr(1900), "USD", perUsd)).toEqual(usd(20));
    expect(convert(inr(1900), "EUR", perUsd)).toEqual({ minor: 1800, currency: "EUR" });
  });

  test("rounds to whole minor units", () => {
    expect(convert({ minor: 1, currency: "USD" }, "INR", perUsd)).toEqual({
      minor: 95,
      currency: "INR",
    });
    expect(convert({ minor: 333, currency: "INR" }, "USD", perUsd)).toEqual({
      minor: 4,
      currency: "USD",
    });
  });

  test("yen has no minor unit, so dollars convert to whole yen and back", () => {
    expect(convert(usd(20), "JPY", perUsd)).toEqual(jpy(3000));
    expect(convert(jpy(3000), "USD", perUsd)).toEqual(usd(20));
    expect(convert(jpy(3000), "INR", perUsd)).toEqual(inr(1900));
    expect(convert(usd(0.01), "JPY", perUsd)).toEqual(jpy(2));
  });

  test("USD needs no rate and the same currency needs none", () => {
    expect(convert(usd(5), "USD", {})).toEqual(usd(5));
    expect(convert(inr(5), "INR", {})).toEqual(inr(5));
    expect(convert(usd(5), "INR", { INR: 90 })).toEqual(inr(450));
  });

  test("a missing or non-positive rate gives null", () => {
    expect(convert(usd(5), "GBP", perUsd)).toBeNull();
    expect(convert({ minor: 500, currency: "GBP" }, "USD", perUsd)).toBeNull();
    expect(convert(usd(5), "INR", { INR: 0 })).toBeNull();
    expect(convert(usd(5), "INR", { INR: -3 })).toBeNull();
  });

  test("names the currency with no rate, the original's first", () => {
    expect(missingRate("USD", "USD", {})).toBeNull();
    expect(missingRate("EUR", "INR", { INR: 95 })).toBe("EUR");
    expect(missingRate("USD", "INR", {})).toBe("INR");
    expect(missingRate("EUR", "INR", {})).toBe("EUR");
  });
});

describe("formatMoney", () => {
  test("drops decimals for whole amounts", () => {
    expect(formatMoney(usd(200))).toBe("$200");
    expect(formatMoney(usd(0))).toBe("$0");
    expect(formatMoney(inr(1999))).toBe("₹1,999");
  });

  test("keeps two decimals otherwise", () => {
    expect(formatMoney({ minor: 112_810, currency: "USD" })).toBe("$1,128.10");
    expect(formatMoney(usd(19.99))).toBe("$19.99");
    expect(formatMoney({ minor: 1667, currency: "USD" })).toBe("$16.67");
  });

  test("uses the currency symbol and the Indian grouping for rupees", () => {
    expect(formatMoney({ minor: 2000, currency: "EUR" })).toBe("€20");
    expect(formatMoney({ minor: 1950, currency: "GBP" })).toBe("£19.50");
    expect(formatMoney(inr(123_456))).toBe("₹1,23,456");
  });

  test("yen never shows decimals, and its minor unit is the whole yen", () => {
    expect(formatMoney(jpy(1500))).toBe("¥1,500");
    expect(formatMoney(jpy(0))).toBe("¥0");
    expect(formatMoney({ minor: 2150, currency: "CAD" })).toBe("CA$21.50");
    expect(formatMoney({ minor: 2000, currency: "BRL" })).toBe("R$20");
    expect(formatMoney({ minor: 2000, currency: "CHF" })).toBe("CHF\u00A020");
  });
});

describe("currencies", () => {
  test("every one has a symbol and a name", () => {
    expect(currencies).toEqual([
      "USD",
      "EUR",
      "GBP",
      "INR",
      "CAD",
      "AUD",
      "JPY",
      "SGD",
      "CHF",
      "BRL",
    ]);
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol("JPY")).toBe("¥");
    expect(currencySymbol("CAD")).toBe("CA$");
    for (const currency of currencies) {
      expect(currencySymbol(currency).length).toBeGreaterThan(0);
      expect(currencyName(currency).length).toBeGreaterThan(0);
    }
    expect(currencyName("INR")).toBe("Indian rupee");
  });

  test("the browser locale suggests a currency, USD otherwise", () => {
    expect(defaultCurrency("en-IN")).toBe("INR");
    expect(defaultCurrency("en-US")).toBe("USD");
    expect(defaultCurrency("en-GB")).toBe("GBP");
    expect(defaultCurrency("de-DE")).toBe("EUR");
    expect(defaultCurrency("ja-JP")).toBe("JPY");
    expect(defaultCurrency("pt-BR")).toBe("BRL");
    expect(defaultCurrency("en")).toBe("USD");
    expect(defaultCurrency("fr-ZZ")).toBe("USD");
    expect(defaultCurrency("")).toBe("USD");
    expect(defaultCurrency("not a locale!")).toBe("USD");
  });
});

describe("parsePositive", () => {
  test("rates and credits are numbers above zero", () => {
    expect(parsePositive("83.5")).toBe(83.5);
    expect(parsePositive("1000")).toBe(1000);
    for (const bad of ["", "0", "-1", "x", "1,5"]) expect(parsePositive(bad)).toBeNull();
  });
});
