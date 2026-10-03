import { describe, expect, test } from "bun:test";

import { connection, metric } from "./test-fixtures.ts";
import {
  amountOf,
  displayCurrencyOf,
  emptyBook,
  monthlyOf,
  rateCurrencies,
  suggestPrices,
  summarize,
  usageSpendOf,
  usedCurrencies,
  type Cost,
  type TopUp,
  type WalletBook,
} from "./wallet.ts";
import type { Money } from "./wallet-money.ts";

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
    // The account shows the converted figure and keeps what was entered beside it.
    expect(summary.providers[0]?.accounts[1]?.monthly).toEqual({
      shown: usd(20),
      original: inr(1900),
      noRate: null,
    });
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
      price: { shown: usd(20), original: null, noRate: null },
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
    expect(summary.topUps.map((item) => item.id)).toEqual(["e", "d", "f", "g", "c", "b", "a"]);
    expect(summary.topUpsThisMonth.paid).toEqual({ money: usd(35), missing: 1 });
    expect(summary.topUpsThisMonth.paidCount).toBe(3);
    expect(summary.topUpsThisMonth.freeCount).toBe(2);
    expect(summary.topUpsThisMonth.items.map((item) => item.id)).toEqual(["d", "f", "g", "c", "b"]);
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

describe("display currency", () => {
  const rates = { USD: 1, INR: 95, EUR: 0.9, JPY: 150 };

  test("the book's choice wins, else the browser locale decides", () => {
    expect(displayCurrencyOf(book({ displayCurrency: "GBP" }), "en-IN")).toBe("GBP");
    expect(displayCurrencyOf(emptyBook, "en-IN")).toBe("INR");
    expect(displayCurrencyOf(emptyBook, "en-US")).toBe("USD");
    expect(summarize([claude], [], emptyBook, now, "en-IN").currency).toBe("INR");
    expect(summarize([claude], [], emptyBook, now).currency).toBe("USD");
    expect(summarize([claude], [], book({ displayCurrency: "EUR" }), now, "en-IN").currency).toBe(
      "EUR",
    );
  });

  test("an amount in the display currency has no original", () => {
    expect(amountOf(usd(20), "USD", rates)).toEqual({
      shown: usd(20),
      original: null,
      noRate: null,
    });
  });

  test("an amount in another currency shows converted with the original beside it", () => {
    expect(amountOf(inr(1900), "USD", rates)).toEqual({
      shown: usd(20),
      original: inr(1900),
      noRate: null,
    });
    expect(amountOf(usd(20), "JPY", rates)).toEqual({
      shown: { minor: 3000, currency: "JPY" },
      original: usd(20),
      noRate: null,
    });
  });

  test("with no rate the original stays, and the currency without a rate is named", () => {
    expect(amountOf(inr(1999), "USD", { USD: 1 })).toEqual({
      shown: null,
      original: inr(1999),
      noRate: "INR",
    });
    expect(amountOf(usd(12), "INR", { USD: 1 })).toEqual({
      shown: null,
      original: usd(12),
      noRate: "INR",
    });
  });

  test("every account, row and total follows the display currency", () => {
    const costs = {
      c1: paid(usd(100), "2026-10-20"),
      c2: paid(inr(1999), "2026-10-08"),
      x1: paid({ minor: 2000, currency: "EUR" }),
      g1: { kind: "free" } satisfies Cost,
    };
    const summary = summarize(
      all,
      [],
      book({ costs, displayCurrency: "INR", perUsd: { USD: 1, INR: 95 } }),
      now,
    );
    const accounts = summary.providers.flatMap((group) => group.accounts);
    const byId = (id: string) => accounts.find((account) => account.connection.id === id);
    expect(byId("c1")?.monthly).toEqual({ shown: inr(9500), original: usd(100), noRate: null });
    expect(byId("c1")?.billed).toEqual({ shown: inr(9500), original: usd(100), noRate: null });
    expect(byId("c2")?.monthly).toEqual({ shown: inr(1999), original: null, noRate: null });
    expect(byId("x1")?.monthly).toEqual({
      shown: null,
      original: { minor: 2000, currency: "EUR" },
      noRate: "EUR",
    });
    // Free is zero in the display currency, never null, even with no rate for anything.
    expect(byId("g1")?.monthly).toEqual({ shown: inr(0), original: null, noRate: null });
    expect(summary.monthly).toEqual({ money: inr(11_499), missing: 1 });
    expect(summary.nextRenewal?.date).toBe("2026-10-08");
    expect(summary.nextRenewal?.price).toEqual({ shown: inr(1999), original: null, noRate: null });
  });

  test("an annual plan shows its monthly share and keeps the yearly price", () => {
    const summary = summarize(
      [claude],
      [],
      book({
        costs: { c1: paid(usd(200), null, "annual") },
        displayCurrency: "INR",
        perUsd: { USD: 1, INR: 95 },
      }),
      now,
    );
    const account = summary.providers[0]?.accounts[0];
    expect(account?.monthly?.shown).toEqual({ minor: 158_365, currency: "INR" });
    expect(account?.billed?.shown).toEqual(inr(19_000));
    expect(account?.billed?.original).toEqual(usd(200));
  });

  test("usage spend converts like any other amount", () => {
    const withSpend = connection("claude", {
      id: "c1",
      metrics: [spend("extra_usage.used", "12.5")],
    });
    const inInr = summarize(
      [withSpend],
      [],
      book({ displayCurrency: "INR", perUsd: { USD: 1, INR: 90 } }),
      now,
    );
    expect(inInr.providers[0]?.accounts[0]?.usageSpend).toEqual({
      shown: inr(1125),
      original: usd(12.5),
      noRate: null,
      label: "Extra usage this month",
    });
    expect(inInr.usageSpend).toEqual({ money: inr(1125), missing: 0 });
    const unrated = summarize([withSpend], [], book({ displayCurrency: "INR" }), now);
    expect(unrated.providers[0]?.accounts[0]?.usageSpend).toEqual({
      shown: null,
      original: usd(12.5),
      noRate: "INR",
      label: "Extra usage this month",
    });
    expect(unrated.usageSpend.missing).toBe(1);
  });

  test("a top-up converts, a free one has no amount", () => {
    const summary = summarize(
      [codex],
      [],
      book({
        displayCurrency: "USD",
        perUsd: { USD: 1, INR: 95 },
        topUps: [
          topUp("a", { price: inr(950) }),
          topUp("b", { price: usd(5) }),
          topUp("c", { kind: "free", price: null }),
          topUp("d", { price: { minor: 100, currency: "GBP" } }),
        ],
      }),
      now,
    );
    const byId = (id: string) => summary.topUps.find((item) => item.id === id)?.amount;
    expect(byId("a")).toEqual({ shown: usd(10), original: inr(950), noRate: null });
    expect(byId("b")).toEqual({ shown: usd(5), original: null, noRate: null });
    expect(byId("c")).toBeNull();
    expect(byId("d")).toEqual({
      shown: null,
      original: { minor: 100, currency: "GBP" },
      noRate: "GBP",
    });
  });

  test("a yen display totals whole yen", () => {
    const summary = summarize(
      [claude],
      [],
      book({ costs: { c1: paid(usd(20)) }, displayCurrency: "JPY", perUsd: { USD: 1, JPY: 150 } }),
      now,
    );
    expect(summary.monthly).toEqual({ money: { minor: 3000, currency: "JPY" }, missing: 0 });
  });
});

describe("currencies in use", () => {
  test("lists the ones the entries use, in the usual order", () => {
    expect(usedCurrencies(emptyBook)).toEqual([]);
    const used = book({
      costs: { a: paid(inr(1999)), b: paid(usd(20)), c: { kind: "free" } },
      topUps: [
        topUp("t", { price: { minor: 500, currency: "EUR" } }),
        topUp("u", { kind: "free", price: null }),
      ],
    });
    expect(usedCurrencies(used)).toEqual(["USD", "EUR", "INR"]);
  });

  test("rates are needed for those and the display currency, never USD", () => {
    expect(rateCurrencies(emptyBook, "USD")).toEqual([]);
    expect(rateCurrencies(emptyBook, "INR")).toEqual(["INR"]);
    expect(rateCurrencies(book({ costs: { a: paid(inr(1999)), b: paid(usd(5)) } }), "EUR")).toEqual(
      ["EUR", "INR"],
    );
  });
});
