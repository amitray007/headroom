import { currencySymbol, minorDigits } from "@headroom/view-model/wallet-money";
import { describe, expect, test } from "bun:test";

import {
  caretAfter,
  draftToMinor,
  formatDraft,
  groupingLocale,
  minorToDraft,
  parseDraft,
  placeholderFor,
  rescaleMinor,
  significantBefore,
} from "./money.ts";

describe("currency facts come from Intl", () => {
  test("digits", () => {
    expect(minorDigits("USD")).toBe(2);
    expect(minorDigits("INR")).toBe(2);
    expect(minorDigits("EUR")).toBe(2);
    expect(minorDigits("GBP")).toBe(2);
    expect(minorDigits("JPY")).toBe(0);
  });

  test("symbols", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol("JPY")).toBe("¥");
  });

  test("grouping locale", () => {
    expect(groupingLocale("INR")).toBe("en-IN");
    expect(groupingLocale("USD")).toBe("en-US");
  });
});

describe("parseDraft", () => {
  test("reads pasted text", () => {
    expect(parseDraft("1,999.50", 2)).toBe("1999.50");
    expect(parseDraft("$20", 2)).toBe("20");
    expect(parseDraft("₹ 12,34,567.8", 2)).toBe("1234567.8");
    expect(parseDraft("abc", 2)).toBe("");
  });

  test("keeps a trailing point while typing", () => {
    expect(parseDraft("12.", 2)).toBe("12.");
    expect(parseDraft(".", 2)).toBe("0.");
    expect(parseDraft(".5", 2)).toBe("0.5");
  });

  test("cuts extra decimals and extra points", () => {
    expect(parseDraft("1.999", 2)).toBe("1.99");
    expect(parseDraft("1.2.3", 2)).toBe("1.23");
  });

  test("drops leading zeros", () => {
    expect(parseDraft("007", 2)).toBe("7");
    expect(parseDraft("0", 2)).toBe("0");
    expect(parseDraft("00.5", 2)).toBe("0.5");
  });

  test("limits the whole part", () => {
    expect(parseDraft("1234567890123456", 2)).toBe("123456789012");
  });

  test("JPY accepts no decimal point", () => {
    expect(parseDraft("1,500", 0)).toBe("1500");
    expect(parseDraft("1500.75", 0)).toBe("1500");
    expect(parseDraft(".", 0)).toBe("");
  });
});

describe("minor units", () => {
  test("draftToMinor", () => {
    expect(draftToMinor("", 2)).toBeNull();
    expect(draftToMinor("12", 2)).toBe(1200);
    expect(draftToMinor("12.5", 2)).toBe(1250);
    expect(draftToMinor("12.", 2)).toBe(1200);
    expect(draftToMinor("0.07", 2)).toBe(7);
    expect(draftToMinor("1999.50", 2)).toBe(199950);
    expect(draftToMinor("20", 2)).toBe(2000);
  });

  test("draftToMinor for JPY has no cents", () => {
    expect(draftToMinor("1500", 0)).toBe(1500);
    expect(draftToMinor("0", 0)).toBe(0);
  });

  test("minorToDraft", () => {
    expect(minorToDraft(null, 2)).toBe("");
    expect(minorToDraft(199950, 2)).toBe("1999.50");
    expect(minorToDraft(7, 2)).toBe("0.07");
    expect(minorToDraft(0, 2)).toBe("0.00");
    expect(minorToDraft(1500, 0)).toBe("1500");
    expect(minorToDraft(0, 0)).toBe("0");
  });

  test("round trip", () => {
    for (const minor of [0, 1, 99, 100, 12345, 999999999999]) {
      expect(draftToMinor(minorToDraft(minor, 2), 2)).toBe(minor);
    }
  });

  test("rescaleMinor keeps the major amount", () => {
    expect(rescaleMinor(1999, 2, 0)).toBe(19);
    expect(rescaleMinor(1500, 0, 2)).toBe(150000);
    expect(rescaleMinor(1500, 2, 2)).toBe(1500);
    expect(rescaleMinor(null, 2, 0)).toBeNull();
  });
});

describe("formatDraft", () => {
  test("groups thousands for en-US", () => {
    expect(formatDraft("1999.5", "en-US")).toBe("1,999.5");
    expect(formatDraft("1234567", "en-US")).toBe("1,234,567");
    expect(formatDraft("12", "en-US")).toBe("12");
    expect(formatDraft("12.", "en-US")).toBe("12.");
    expect(formatDraft("", "en-US")).toBe("");
  });

  test("groups lakh and crore for en-IN", () => {
    expect(formatDraft("1234567.5", "en-IN")).toBe("12,34,567.5");
    expect(formatDraft("99999", "en-IN")).toBe("99,999");
    expect(formatDraft("100000", "en-IN")).toBe("1,00,000");
  });

  test("keeps the largest whole part exact", () => {
    expect(formatDraft("999999999999", "en-US")).toBe("999,999,999,999");
  });
});

describe("caret", () => {
  test("significantBefore counts digits and the point", () => {
    expect(significantBefore("1,999.50", 3, 2)).toBe(2);
    expect(significantBefore("1,999.50", 8, 2)).toBe(7);
    expect(significantBefore("", 0, 2)).toBe(0);
  });

  test("caretAfter finds the spot after n meaningful characters", () => {
    expect(caretAfter("1,999.50", 0)).toBe(0);
    expect(caretAfter("1,999.50", 1)).toBe(1);
    expect(caretAfter("1,999.50", 2)).toBe(3);
    expect(caretAfter("1,999.50", 99)).toBe(8);
  });

  test("typing a digit that adds a group separator keeps the caret at the end", () => {
    // "999" then a typed "9": raw "9999", caret 4, becomes "9,999".
    const display = formatDraft(parseDraft("9999", 2), "en-US");
    expect(caretAfter(display, significantBefore("9999", 4, 2))).toBe(display.length);
  });
});

describe("placeholder", () => {
  test("matches the currency's decimals", () => {
    expect(placeholderFor(2)).toBe("0.00");
    expect(placeholderFor(0)).toBe("0");
  });
});
