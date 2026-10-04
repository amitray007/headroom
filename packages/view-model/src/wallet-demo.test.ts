import { describe, expect, test } from "bun:test";

import { demoOverview } from "./demo.ts";
import { demoWallet } from "./wallet-demo.ts";
import { summarize } from "./wallet.ts";
import { currencies } from "./wallet-money.ts";

const anchor = Date.UTC(2026, 9, 3, 12, 0, 0);
const seeds = [1, 2, 7, 42, 99, 1234, 20_261_003];
const day = 86_400_000;
const rates = { USD: 1, EUR: 0.88, GBP: 0.75, INR: 95.16, JPY: 149.2 };

const build = (seed: number) => {
  const overview = demoOverview(seed, anchor);
  return { overview, book: demoWallet(seed, overview.connections, anchor) };
};

describe("demoWallet", () => {
  test("the same seed gives the same book", () => {
    for (const seed of seeds) {
      expect(build(seed).book).toEqual(build(seed).book);
    }
  });

  test("every cost and top-up references a real demo connection", () => {
    for (const seed of seeds) {
      const { overview, book } = build(seed);
      const ids = new Set(overview.connections.map((connection) => connection.id));
      for (const id of Object.keys(book.costs)) expect(ids.has(id)).toBe(true);
      for (const topUp of book.topUps) expect(ids.has(topUp.connectionId)).toBe(true);
    }
  });

  test("shows every kind, one paid-looking account Not set, and one account billed in rupees", () => {
    for (const seed of seeds) {
      const { overview, book } = build(seed);
      const summary = summarize(overview.connections, overview.providerOrder, book, rates, anchor);
      expect(summary.counts.paid).toBeGreaterThan(1);
      expect(summary.counts.free).toBeGreaterThan(0);
      expect(summary.counts.included).toBeGreaterThan(0);
      expect(summary.counts.notSet).toBe(1);
      const notSet = summary.providers
        .flatMap((group) => group.accounts)
        .find((account) => account.cost === null);
      expect(notSet?.connection.provider).toBe("cursor");
      const costs = Object.values(book.costs);
      expect(costs.some((cost) => cost.kind === "paid" && cost.cycle === "annual")).toBe(true);
      expect(costs.some((cost) => cost.kind === "paid" && cost.price.currency === "INR")).toBe(
        true,
      );
      expect(summary.monthly.missing).toBe(0);
      expect(summary.monthly.money.minor).toBeGreaterThan(0);
    }
  });

  test("renewals fall 1 to 28 days after the anchor", () => {
    for (const seed of seeds) {
      for (const cost of Object.values(build(seed).book.costs)) {
        if (cost.kind !== "paid") continue;
        expect(cost.renewsOn).not.toBeNull();
        const days = (Date.parse(`${cost.renewsOn}T00:00:00Z`) - Date.UTC(2026, 9, 3)) / day;
        expect(days).toBeGreaterThanOrEqual(1);
        expect(days).toBeLessThanOrEqual(29);
      }
    }
  });

  test("has paid and free top-ups from the anchor day back 40 days", () => {
    for (const seed of seeds) {
      const { topUps } = build(seed).book;
      expect(topUps.length).toBeGreaterThanOrEqual(2);
      expect(topUps.length).toBeLessThanOrEqual(6);
      expect(topUps.some((topUp) => topUp.kind === "paid" && topUp.price?.currency === "USD")).toBe(
        true,
      );
      expect(topUps.some((topUp) => topUp.kind === "free" && topUp.price === null)).toBe(true);
      for (const topUp of topUps) {
        const age = (Date.UTC(2026, 9, 3) - Date.parse(`${topUp.date}T00:00:00Z`)) / day;
        expect(age).toBeGreaterThanOrEqual(0);
        expect(age).toBeLessThanOrEqual(40);
      }
    }
  });

  test("with a rate for every currency, any display currency totals without gaps", () => {
    const { overview, book } = build(1);
    expect(book.displayCurrency).toBeNull();
    const all = Object.fromEntries(currencies.map((currency) => [currency, 2]));
    for (const currency of currencies) {
      const summary = summarize(
        overview.connections,
        overview.providerOrder,
        { ...book, displayCurrency: currency },
        all,
        anchor,
      );
      expect(summary.currency).toBe(currency);
      expect(summary.monthly.missing).toBe(0);
      expect(summary.usageSpend.missing).toBe(0);
      expect(summary.topUpsThisMonth.paid.missing).toBe(0);
    }
  });

  test("without a choice the browser locale decides the display currency", () => {
    const { overview, book } = build(1);
    const at = (locale: string) =>
      summarize(overview.connections, overview.providerOrder, book, null, anchor, locale).currency;
    expect(at("en-IN")).toBe("INR");
    expect(at("en-US")).toBe("USD");
  });

  test("one top-up was detected with no price, and one expires inside its alert window", () => {
    for (const seed of seeds) {
      const { topUps } = build(seed).book;
      const detected = topUps.filter((topUp) => topUp.source === "detected");
      expect(detected).toHaveLength(1);
      expect(detected[0]?.kind).toBe("paid");
      expect(detected[0]?.price).toBeNull();
      expect(
        topUps.filter((topUp) => topUp.source === "owner" && topUp.kind === "paid"),
      ).not.toEqual([]);
      const expiring = topUps.filter((topUp) => topUp.expiresOn !== null);
      expect(expiring).toHaveLength(1);
      const left = (Date.parse(`${expiring[0]?.expiresOn}T00:00:00Z`) - Date.UTC(2026, 9, 3)) / day;
      expect(left).toBeGreaterThan(0);
      expect(left).toBeLessThanOrEqual(expiring[0]?.expiryAlertDays ?? 0);
    }
  });

  test("the detected top-up is left out of money totals and counted as not priced", () => {
    const { overview, book } = build(1);
    const summary = summarize(overview.connections, overview.providerOrder, book, null, anchor);
    expect(summary.topUpsThisMonth.unpriced).toBe(1);
    expect(summary.topUpsThisMonth.paid.missing).toBe(0);
    expect(summary.topUpMonths.at(-1)?.unpriced).toBe(1);
  });
});
