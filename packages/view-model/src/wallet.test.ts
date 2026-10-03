import { describe, expect, test } from "bun:test";

import { connection, metric } from "./test-fixtures.ts";
import {
  convert,
  emptyBook,
  formatMoney,
  monthlyOf,
  suggestPrices,
  summarize,
  usageSpendOf,
  type Cost,
  type Money,
  type TopUp,
  type WalletBook,
} from "./wallet.ts";

const usd = (dollars: number): Money => ({ minor: Math.round(dollars * 100), currency: "USD" });
const inr = (rupees: number): Money => ({ minor: rupees * 100, currency: "INR" });
const paid = (
  price: Money,
  renewsOn: string | null = null,
  cycle: "monthly" | "annual" = "monthly",
) => ({ kind: "paid", price, cycle, renewsOn }) satisfies Cost;

const spend = (key: string, text: string | null, over = {}) =>
  metric(key, {
    kind: "spend",
    scope: "month",
    valueText: text,
    valueNum: text === null ? null : Number(text),
    unit: "USD",
    ...over,
  });

describe("monthlyOf", () => {
  test("a monthly price is the price", () => {
    expect(monthlyOf(paid(usd(20)))).toEqual(usd(20));
  });

  test("an annual price is a twelfth, rounded to the minor unit", () => {
    expect(monthlyOf(paid(usd(200), null, "annual"))).toEqual({ minor: 1667, currency: "USD" });
    expect(monthlyOf(paid(inr(12_000), null, "annual"))).toEqual(inr(1000));
  });

  test("free and included are zero dollars", () => {
    expect(monthlyOf({ kind: "free" })).toEqual({ minor: 0, currency: "USD" });
    expect(monthlyOf({ kind: "included", includedWith: "X Premium" })).toEqual({
      minor: 0,
      currency: "USD",
    });
  });

  test("Not set stays unknown", () => {
    expect(monthlyOf(null)).toBeNull();
  });
});

describe("convert", () => {
  const perUsd = { USD: 1, INR: 95, EUR: 0.9 };

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
});

const read = (provider: "claude" | "cursor" | "vercel_ai_gateway", key: string, text: string) =>
  usageSpendOf(connection(provider, { metrics: [spend(key, text)] }));

const claudeSpend = (over: object) =>
  usageSpendOf(connection("claude", { metrics: [spend("extra_usage.used", "5", over)] }));

describe("usageSpendOf", () => {
  test("reads each provider's spend metric", () => {
    expect(read("claude", "extra_usage.used", "12.5")).toEqual({
      money: usd(12.5),
      label: "Extra usage this month",
    });
    expect(read("cursor", "on_demand.used", "3.07")).toEqual({
      money: usd(3.07),
      label: "On-demand this cycle",
    });
    expect(read("vercel_ai_gateway", "spend.30d", "41.123456")).toEqual({
      money: usd(41.12),
      label: "Last 30 days",
    });
  });

  test("an unavailable metric, no value or a non-USD unit gives null", () => {
    expect(claudeSpend({ availability: "unknown", valueText: null, valueNum: null })).toBeNull();
    expect(claudeSpend({ valueNum: null })).toBeNull();
    expect(claudeSpend({ unit: "gateway_credits" })).toBeNull();
  });

  test("no snapshot or no such metric gives null", () => {
    expect(usageSpendOf(connection("claude", { metrics: [] }))).toBeNull();
    expect(usageSpendOf({ ...connection("claude"), snapshot: null })).toBeNull();
  });

  test("Grok on-demand is credits, never money", () => {
    const grok = connection("grok", {
      metrics: [
        spend("on_demand.used", "40", { unit: "grok_credits", kind: "spend" }),
        spend("extra_usage.used", "9"),
      ],
    });
    expect(usageSpendOf(grok)).toBeNull();
  });
});

describe("suggestPrices", () => {
  test("Claude max offers both Max plans, 5x first", () => {
    expect(suggestPrices("claude", "max").map((item) => item.label)).toEqual(["Max 5x", "Max 20x"]);
    expect(suggestPrices("claude", "Max 20x").map((item) => item.label)[0]).toBe("Max 20x");
  });

  test("matching is case-insensitive and loose", () => {
    expect(suggestPrices("claude", "PRO").map((item) => item.label)).toEqual(["Pro", "Pro annual"]);
    expect(suggestPrices("cursor", "pro_plus").map((item) => item.label)[0]).toBe("Pro+");
    expect(suggestPrices("grok", "SuperGrok Heavy").map((item) => item.label)[0]).toBe(
      "SuperGrok Heavy",
    );
    expect(suggestPrices("antigravity", "Google AI Pro")[0]?.price).toEqual(usd(19.99));
    expect(suggestPrices("codex", "prolite")[0]?.label).toBe("Pro 100");
    expect(suggestPrices("copilot", "individual").map((item) => item.label)).toEqual([
      "Pro",
      "Pro+",
    ]);
  });

  test("a null plan returns every option of the provider", () => {
    expect(suggestPrices("codex", null).map((item) => item.label)).toEqual([
      "Go",
      "Plus",
      "Pro 100",
      "Pro 200",
      "Pro 500",
    ]);
  });

  test("an unknown plan, an unknown provider catalog and Vercel give nothing", () => {
    expect(suggestPrices("claude", "enterprise")).toEqual([]);
    expect(suggestPrices("grok", "x_premium")).toEqual([]);
    expect(suggestPrices("vercel_ai_gateway", null)).toEqual([]);
    expect(suggestPrices("vercel_ai_gateway", "pro")).toEqual([]);
  });

  test("every suggestion is a dated USD list price", () => {
    for (const provider of [
      "claude",
      "codex",
      "copilot",
      "cursor",
      "grok",
      "antigravity",
    ] as const) {
      for (const item of suggestPrices(provider, null)) {
        expect(item.asOf).toBe("2026-10");
        expect(item.price.currency).toBe("USD");
        expect(item.price.minor).toBeGreaterThan(0);
      }
    }
  });
});

const now = Date.UTC(2026, 9, 3, 12);
const claude = connection("claude", { id: "c1", plan: "max" });
const claude2 = connection("claude", { id: "c2" });
const codex = connection("codex", { id: "x1" });
const grok = connection("grok", { id: "g1" });
const vercel = connection("vercel_ai_gateway", { id: "v1" });
const all = [claude, claude2, codex, grok, vercel];
const book = (over: Partial<WalletBook>): WalletBook => ({ ...emptyBook, ...over });
const topUp = (id: string, over: Partial<TopUp>): TopUp => ({
  id,
  connectionId: "x1",
  date: "2026-10-01",
  kind: "paid",
  price: usd(10),
  credits: null,
  note: null,
  ...over,
});
const rolled = (renewsOn: string, cycle: "monthly" | "annual", at = now) =>
  summarize([claude], [], book({ costs: { c1: paid(usd(20), renewsOn, cycle) } }), at).providers[0]
    ?.accounts[0]?.nextRenewal;

describe("summarize", () => {
  test("groups by the saved provider order and counts every kind", () => {
    const summary = summarize(
      all,
      ["codex", "claude"],
      book({
        costs: {
          c1: paid(usd(200)),
          x1: paid(usd(20)),
          g1: { kind: "included", includedWith: "X Premium" },
          v1: { kind: "free" },
        },
      }),
      now,
    );
    expect(summary.providers.map((group) => group.provider)).toEqual([
      "codex",
      "claude",
      "grok",
      "vercel_ai_gateway",
    ]);
    expect(summary.counts).toEqual({ paid: 2, free: 1, included: 1, notSet: 1 });
    expect(summary.monthly).toEqual({ money: usd(220), missing: 0 });
    expect(summary.providers[1]?.monthly).toEqual({ money: usd(200), missing: 0 });
    expect(summary.providers[1]?.accounts[1]?.cost).toBeNull();
    expect(summary.providers[1]?.accounts[1]?.monthly).toBeNull();
  });

  test("Not set is not counted as zero in totals", () => {
    const summary = summarize([claude2], [], book({}), now);
    expect(summary.counts.notSet).toBe(1);
    expect(summary.monthly).toEqual({ money: usd(0), missing: 0 });
  });

  test("converts into the display currency and counts amounts with no rate", () => {
    const costs = {
      c1: paid(usd(100)),
      c2: paid(inr(1900)),
      x1: paid({ minor: 2000, currency: "EUR" }),
    };
    const summary = summarize(
      all,
      [],
      book({ costs, displayCurrency: "USD", perUsd: { USD: 1, INR: 95 } }),
      now,
    );
    expect(summary.monthly).toEqual({ money: usd(120), missing: 1 });
    expect(summary.providers.find((group) => group.provider === "codex")?.monthly).toEqual({
      money: usd(0),
      missing: 1,
    });
    // The account keeps its own currency.
    expect(summary.providers[0]?.accounts[1]?.monthly).toEqual(inr(1900));
    const inInr = summarize(
      all,
      [],
      book({ costs, displayCurrency: "INR", perUsd: { USD: 1, INR: 95 } }),
      now,
    );
    expect(inInr.monthly).toEqual({ money: inr(11_400), missing: 1 });
  });

  test("annual costs count a twelfth", () => {
    const summary = summarize(
      [claude],
      [],
      book({ costs: { c1: paid(usd(200), null, "annual") } }),
      now,
    );
    expect(summary.monthly.money).toEqual({ minor: 1667, currency: "USD" });
  });

  test("renewals roll forward across a month and a year", () => {
    expect(rolled("2026-10-03", "monthly")).toBe("2026-10-03");
    expect(rolled("2026-09-20", "monthly")).toBe("2026-10-20");
    expect(rolled("2026-01-31", "monthly", Date.UTC(2026, 2, 1))).toBe("2026-03-31");
    expect(rolled("2026-01-31", "monthly", Date.UTC(2026, 1, 10))).toBe("2026-02-28");
    expect(rolled("2026-11-30", "monthly", Date.UTC(2026, 11, 31))).toBe("2027-01-30");
    expect(rolled("2026-12-15", "monthly", Date.UTC(2027, 0, 2))).toBe("2027-01-15");
    expect(rolled("2025-06-01", "annual")).toBe("2027-06-01");
    expect(rolled("2024-02-29", "annual", Date.UTC(2026, 2, 1))).toBe("2027-02-28");
    expect(rolled("2026-12-31", "annual")).toBe("2026-12-31");
    expect(rolled("not a date", "monthly")).toBeNull();
  });

  test("the soonest renewal comes from paid accounts only", () => {
    const summary = summarize(
      all,
      [],
      book({
        costs: {
          c1: paid(usd(100), "2026-10-20"),
          x1: paid(usd(20), "2026-10-07"),
          c2: paid(usd(20)),
          g1: { kind: "free" },
        },
      }),
      now,
    );
    expect(summary.nextRenewal).toEqual({
      connectionId: "x1",
      date: "2026-10-07",
      price: usd(20),
    });
    expect(summarize(all, [], book({}), now).nextRenewal).toBeNull();
  });

  test("usage spend is totalled in the display currency", () => {
    const withSpend = connection("claude", {
      id: "c1",
      metrics: [spend("extra_usage.used", "12.5")],
    });
    const cursor = connection("cursor", {
      id: "u1",
      metrics: [spend("on_demand.used", "7.5")],
    });
    const summary = summarize([withSpend, cursor], [], emptyBook, now);
    expect(summary.usageSpend).toEqual({ money: usd(20), missing: 0 });
    expect(summary.providers[0]?.accounts[0]?.usageSpend?.label).toBe("Extra usage this month");
    const noRate = summarize([withSpend], [], book({ displayCurrency: "INR" }), now);
    expect(noRate.usageSpend).toEqual({ money: inr(0), missing: 1 });
  });

  test("top-ups sort newest first and the month window is the UTC calendar month", () => {
    const topUps = [
      topUp("a", { date: "2026-09-30" }),
      topUp("b", { date: "2026-10-01", price: usd(25) }),
      topUp("c", { date: "2026-10-02", kind: "free", price: null }),
      topUp("d", { date: "2026-10-31", price: inr(950) }),
      topUp("e", { date: "2026-11-01" }),
      topUp("f", { date: "2026-10-15", kind: "free", price: null }),
      topUp("g", { date: "2026-10-10", price: { minor: 100, currency: "GBP" } }),
    ];
    const summary = summarize([codex], [], book({ topUps, perUsd: { USD: 1, INR: 95 } }), now);
    expect(summary.providers[0]?.accounts[0]?.topUps.map((item) => item.id)).toEqual([
      "e",
      "d",
      "f",
      "g",
      "c",
      "b",
      "a",
    ]);
    expect(summary.topUpsThisMonth).toEqual({
      paid: { money: usd(35), missing: 1 },
      freeCount: 2,
    });
  });

  test("the month is read in UTC", () => {
    const late = Date.UTC(2026, 9, 31, 23, 59);
    const summary = summarize(
      [codex],
      [],
      book({ topUps: [topUp("a", { date: "2026-10-31" }), topUp("b", { date: "2026-11-01" })] }),
      late,
    );
    expect(summary.topUpsThisMonth.paid.money).toEqual(usd(10));
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
});
