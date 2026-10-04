import { describe, expect, test } from "bun:test";

import { connection, credit, metric } from "./test-fixtures.ts";
import {
  amountOf,
  bankedText,
  creditBalanceText,
  creditsOf,
  displayCurrencyOf,
  emptyBook,
  monthlyOf,
  providerSpend,
  suggestPrices,
  summarize,
  topUpMonths,
  upcomingRenewals,
  usageSpendOf,
  type Cost,
  type TopUp,
  type WalletBook,
} from "./wallet.ts";
import type { Money, Rates } from "./wallet-money.ts";

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
  summarize([claude], [], book({ costs: { c1: paid(usd(20), renewsOn, cycle) } }), null, at)
    .providers[0]?.accounts[0]?.nextRenewal;

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
      null,
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

  test("all-in adds subscriptions, usage spend and this month's paid top-ups", () => {
    const withSpend = connection("claude", {
      id: "c1",
      metrics: [spend("extra_usage.used", "12.5")],
    });
    const summary = summarize(
      [withSpend, codex],
      [],
      book({
        costs: { c1: paid(usd(100)), x1: paid(inr(1900)) },
        topUps: [
          topUp("a", { date: "2026-10-01", price: usd(25) }),
          topUp("b", { date: "2026-09-30", price: usd(99) }),
          topUp("c", { kind: "free", price: null }),
          topUp("d", { price: { minor: 100, currency: "GBP" } }),
        ],
      }),
      { USD: 1, INR: 95 },
      now,
    );
    // 100 + 20 subscriptions, 12.50 usage, 25 top-up; the GBP top-up has no rate.
    expect(summary.allIn).toEqual({ money: usd(157.5), missing: 1 });
  });

  test("Not set is not counted as zero in totals", () => {
    const summary = summarize([claude2], [], book({}), null, now);
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
      book({ costs, displayCurrency: "USD" }),
      { USD: 1, INR: 95 },
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
      book({ costs, displayCurrency: "INR" }),
      { USD: 1, INR: 95 },
      now,
    );
    expect(inInr.monthly).toEqual({ money: inr(11_400), missing: 1 });
  });

  test("annual costs count a twelfth", () => {
    const summary = summarize(
      [claude],
      [],
      book({ costs: { c1: paid(usd(200), null, "annual") } }),
      null,
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
      null,
      now,
    );
    expect(summary.nextRenewal).toEqual({
      connectionId: "x1",
      date: "2026-10-07",
      price: { shown: usd(20), original: null, noRate: null },
    });
    expect(summarize(all, [], book({}), null, now).nextRenewal).toBeNull();
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
    const summary = summarize([withSpend, cursor], [], emptyBook, null, now);
    expect(summary.usageSpend).toEqual({ money: usd(20), missing: 0 });
    expect(summary.providers[0]?.accounts[0]?.usageSpend?.label).toBe("Extra usage this month");
    const noRate = summarize([withSpend], [], book({ displayCurrency: "INR" }), null, now);
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
    const summary = summarize([codex], [], book({ topUps }), { USD: 1, INR: 95 }, now);
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
      null,
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
    expect(summarize([claude], [], emptyBook, null, now, "en-IN").currency).toBe("INR");
    expect(summarize([claude], [], emptyBook, null, now).currency).toBe("USD");
    expect(
      summarize([claude], [], book({ displayCurrency: "EUR" }), null, now, "en-IN").currency,
    ).toBe("EUR");
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
      book({ costs, displayCurrency: "INR" }),
      { USD: 1, INR: 95 },
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
      }),
      { USD: 1, INR: 95 },
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
      book({ displayCurrency: "INR" }),
      { USD: 1, INR: 90 },
      now,
    );
    expect(inInr.providers[0]?.accounts[0]?.usageSpend).toEqual({
      shown: inr(1125),
      original: usd(12.5),
      noRate: null,
      label: "Extra usage this month",
    });
    expect(inInr.usageSpend).toEqual({ money: inr(1125), missing: 0 });
    const unrated = summarize([withSpend], [], book({ displayCurrency: "INR" }), null, now);
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
        topUps: [
          topUp("a", { price: inr(950) }),
          topUp("b", { price: usd(5) }),
          topUp("c", { kind: "free", price: null }),
          topUp("d", { price: { minor: 100, currency: "GBP" } }),
        ],
      }),
      { USD: 1, INR: 95 },
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
      book({ costs: { c1: paid(usd(20)) }, displayCurrency: "JPY" }),
      { USD: 1, JPY: 150 },
      now,
    );
    expect(summary.monthly).toEqual({ money: { minor: 3000, currency: "JPY" }, missing: 0 });
  });
});

const months = (over: Partial<WalletBook>, rates: Rates | null = null) =>
  summarize(all, [], book({ displayCurrency: "USD", ...over }), rates, now).topUpMonths;
const renewals = (costs: Record<string, Cost>) =>
  summarize(all, [], book({ costs, displayCurrency: "USD" }), null, now).renewals;

describe("topUpMonths", () => {
  test("covers the last six months, oldest first, the current month last", () => {
    expect(months({}).map((entry) => entry.month)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(months({})[0]?.paid).toEqual({ money: usd(0), missing: 0 });
  });

  test("totals paid top-ups per month, skips free ones and anything older", () => {
    const result = months({
      topUps: [
        topUp("a", { date: "2026-10-01", price: usd(10) }),
        topUp("b", { date: "2026-10-02", price: usd(5.5) }),
        topUp("c", { date: "2026-09-30", price: usd(20) }),
        topUp("d", { date: "2026-10-02", kind: "free", price: null }),
        topUp("e", { date: "2026-04-30", price: usd(99) }),
      ],
    });
    expect(result.map((entry) => entry.paid.money.minor)).toEqual([0, 0, 0, 0, 2000, 1550]);
  });

  test("converts to the display currency and leaves out a price with no rate", () => {
    const result = months(
      {
        topUps: [
          topUp("a", { price: inr(500) }),
          topUp("b", { price: { minor: 900, currency: "EUR" } }),
        ],
      },
      { USD: 1, INR: 100 },
    );
    expect(result[5]?.paid).toEqual({ money: usd(5), missing: 1 });
  });

  test("a window that crosses a year end labels each month", () => {
    const early = topUpMonths([], "2026-02-10", 6, "USD");
    expect(early.map((entry) => entry.month)).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("upcomingRenewals", () => {
  test("lists paid accounts renewing in the next 30 days, soonest first", () => {
    const result = renewals({
      c1: paid(usd(100), "2026-10-20"),
      x1: paid(usd(20), "2026-10-05"),
      c2: paid(usd(30), "2026-11-02"),
    });
    expect(result.map((item) => [item.connectionId, item.date])).toEqual([
      ["x1", "2026-10-05"],
      ["c1", "2026-10-20"],
    ]);
    expect(result[0]?.price.shown).toEqual(usd(20));
  });

  test("includes today and the thirtieth day, not the thirty-first", () => {
    const result = renewals({
      c1: paid(usd(1), "2026-10-03"),
      x1: paid(usd(2), "2026-11-01"),
      c2: paid(usd(3), "2026-11-02"),
    });
    expect(result.map((item) => item.connectionId)).toEqual(["c1", "x1"]);
  });

  test("leaves out free, included, undated and Not set accounts", () => {
    expect(
      renewals({
        c1: { kind: "free" },
        x1: paid(usd(20)),
        g1: { kind: "included", includedWith: "X Premium" },
      }),
    ).toEqual([]);
  });

  test("rolls a past date forward into the window and keeps the billed price", () => {
    const result = upcomingRenewals(
      summarize(
        [claude],
        [],
        book({ costs: { c1: paid(usd(200), "2026-01-15", "annual") }, displayCurrency: "USD" }),
        null,
        now,
      ).providers,
      "2027-01-10",
      30,
    );
    expect(result[0]?.date).toBe("2027-01-15");
    expect(result[0]?.price.shown).toEqual(usd(200));
  });

  test("a renewal with no rate stays listed with its original amount", () => {
    const result = renewals({ c1: paid(inr(1900), "2026-10-10") });
    expect(result[0]?.price.shown).toBeNull();
    expect(result[0]?.price.original).toEqual(inr(1900));
  });
});

describe("providerSpend", () => {
  const connections = [
    connection("claude", { id: "c1", metrics: [spend("extra_usage.used", "12.5")] }),
    connection("claude", { id: "c2", metrics: [spend("extra_usage.used", "7.5")] }),
    codex,
    connection("cursor", { id: "u1", metrics: [spend("on_demand.used", "3")] }),
  ];

  test("splits each provider into plans, usage and this month's paid top-ups, largest first", () => {
    const summary = summarize(
      connections,
      [],
      book({
        costs: { c1: paid(usd(100)), c2: paid(usd(20)), x1: { kind: "free" }, u1: paid(usd(60)) },
        topUps: [
          {
            id: "t1",
            connectionId: "u1",
            date: "2026-10-03",
            kind: "paid",
            price: usd(10),
            credits: null,
            note: null,
          },
          {
            id: "t2",
            connectionId: "u1",
            date: "2026-01-01",
            kind: "paid",
            price: usd(99),
            credits: null,
            note: null,
          },
        ],
        displayCurrency: "USD",
      }),
      null,
      now,
    );
    expect(providerSpend(summary)).toEqual([
      { provider: "claude", plan: 12_000, usage: 2000, topUps: 0, total: 14_000 },
      { provider: "cursor", plan: 6000, usage: 300, topUps: 1000, total: 7300 },
    ]);
  });

  test("the parts add up to the all-in total", () => {
    const summary = summarize(
      connections,
      [],
      book({ costs: { c1: paid(usd(100)), u1: paid(usd(60)) }, displayCurrency: "USD" }),
      null,
      now,
    );
    const sum = providerSpend(summary).reduce((acc, part) => acc + part.total, 0);
    expect(sum).toBe(summary.allIn.money.minor);
  });

  test("keeps top-ups of a removed account as one part, so the ring still matches all-in", () => {
    const summary = summarize(
      connections,
      [],
      book({
        costs: { c1: paid(usd(100)) },
        topUps: [
          {
            id: "t1",
            connectionId: "gone",
            date: "2026-10-03",
            kind: "paid",
            price: usd(5),
            credits: null,
            note: null,
          },
          {
            id: "t2",
            connectionId: "gone2",
            date: "2026-10-02",
            kind: "paid",
            price: usd(2),
            credits: null,
            note: null,
          },
        ],
        displayCurrency: "USD",
      }),
      null,
      now,
    );
    const parts = providerSpend(summary);
    expect(parts.find((part) => part.provider === "removed")).toEqual({
      provider: "removed",
      plan: 0,
      usage: 0,
      topUps: 700,
      total: 700,
    });
    expect(parts.reduce((acc, part) => acc + part.total, 0)).toBe(summary.allIn.money.minor);
  });

  test("leaves out an amount with no rate, and a provider with nothing", () => {
    const summary = summarize(
      [codex, connection("claude", { id: "c1" })],
      [],
      book({ costs: { c1: paid(inr(1900)) }, displayCurrency: "USD" }),
      null,
      now,
    );
    expect(providerSpend(summary)).toEqual([]);
  });
});

const credits = (key: string, value: number | null, over = {}) =>
  metric(key, {
    kind: "credits",
    scope: "account",
    valueText: value === null ? null : String(value),
    valueNum: value,
    unit: "credits",
    availability: value === null ? "unknown" : "available",
    ...over,
  });
const resets = (key: string, count: number) =>
  metric(key, {
    kind: "reset_inventory",
    scope: "account",
    valueText: String(count),
    valueNum: count,
    unit: "resets",
  });

describe("creditsOf", () => {
  test("Codex: the credit balance and banked full resets", () => {
    const account = connection("codex", {
      metrics: [credits("credits.balance", 1128), resets("reset_credits.available_count", 2)],
    });
    expect(creditsOf(account)).toEqual({ balance: { value: 1128, unlimited: false }, resets: 2 });
  });

  test("Codex counts usable stored resets when the count metric is missing", () => {
    const account = connection("codex", {
      resetCredits: [credit("a"), credit("b", { usable: false })],
    });
    expect(creditsOf(account)).toEqual({ balance: null, resets: 1 });
  });

  test("Claude: reset grants only, no balance", () => {
    const account = connection("claude", { metrics: [resets("reset_grants.available", 3)] });
    expect(creditsOf(account)).toEqual({ balance: null, resets: 3 });
  });

  test("Grok: the prepaid balance; Vercel AI Gateway: the credit balance, not the credits used", () => {
    const prepaid = connection("grok", { metrics: [credits("prepaid_balance", 12.5)] });
    expect(creditsOf(prepaid)?.balance).toEqual({ value: 12.5, unlimited: false });
    const gateway = connection("vercel_ai_gateway", {
      metrics: [credits("credits.balance", 40.45), credits("credits.total_used", 59.55)],
    });
    expect(creditsOf(gateway)).toEqual({
      balance: { value: 40.45, unlimited: false },
      resets: null,
    });
  });

  test("an unreported balance is unknown, not zero", () => {
    const account = connection("codex", { metrics: [credits("credits.balance", null)] });
    expect(creditsOf(account)).toBeNull();
    expect(creditsOf(connection("grok"))).toBeNull();
  });

  test("a real zero balance stays zero; zero banked resets are not shown", () => {
    const account = connection("codex", {
      metrics: [credits("credits.balance", 0), resets("reset_credits.available_count", 0)],
    });
    expect(creditsOf(account)).toEqual({ balance: { value: 0, unlimited: false }, resets: null });
  });

  test("an unlimited balance has no figure", () => {
    const account = connection("codex", {
      metrics: [credits("credits.balance", null, { unlimited: true, availability: "available" })],
    });
    expect(creditsOf(account)?.balance).toEqual({ value: null, unlimited: true });
  });

  test("providers with neither report none, and an account carries its credits in the summary", () => {
    expect(
      creditsOf(connection("cursor", { metrics: [credits("credits.balance", 5)] })),
    ).toBeNull();
    const withBalance = connection("grok", { id: "g2", metrics: [credits("prepaid_balance", 7)] });
    const summary = summarize([withBalance], [], emptyBook, null, now);
    expect(summary.providers[0]?.accounts[0]?.credits?.balance?.value).toBe(7);
  });

  test("formats balance and banked resets", () => {
    expect(creditBalanceText({ value: 1128, unlimited: false })).toBe("1,128 credits");
    expect(creditBalanceText({ value: 1, unlimited: false })).toBe("1 credit");
    expect(creditBalanceText({ value: 40.45, unlimited: false })).toBe("40.45 credits");
    expect(creditBalanceText({ value: null, unlimited: true })).toBe("Unlimited credits");
    expect(bankedText(2)).toBe("2 resets banked");
    expect(bankedText(1)).toBe("1 reset banked");
  });
});
