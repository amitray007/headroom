import type { Provider } from "@headroom/core/contracts";

import { groupByProvider } from "./labels.ts";
import type { OverviewConnection } from "./overview.ts";
import { isoDate, rollForward, type Cycle } from "./wallet-dates.ts";
import {
  convert,
  currencies,
  defaultCurrency,
  missingRate,
  toMinor,
  type Currency,
  type Money,
  type Rates,
} from "./wallet-money.ts";

/**
 * Wallet: what the owner pays for each account, in money. Exploration on the `wallet-exploration` branch.
 * Providers never report what an account costs, so every cost and top-up here is owner-entered; only usage spend
 * (Claude extra usage, Cursor on-demand, Vercel 30-day spend) comes from the provider's own figures.
 */

/**
 * What one account costs. An account with no entry is "Not set": unknown, never zero.
 * `included` means it comes with another subscription (X Premium, GitHub Pro, Google AI Pro) and adds nothing here.
 */
export type Cost =
  | {
      readonly kind: "paid";
      readonly price: Money;
      readonly cycle: Cycle;
      /** The next renewal as `YYYY-MM-DD`, or null when not entered. */
      readonly renewsOn: string | null;
    }
  | { readonly kind: "free" }
  | { readonly kind: "included"; readonly includedWith: string };

/** Credits added to an account outside its subscription: bought (paid) or received (free). */
export interface TopUp {
  readonly id: string;
  readonly connectionId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly kind: "paid" | "free";
  /** Set for a paid top-up, null for a free one. */
  readonly price: Money | null;
  /** Credits added in the provider's own unit, when the owner knows it. */
  readonly credits: number | null;
  readonly note: string | null;
}

/** Everything the owner entered. */
export interface WalletBook {
  /** Keyed by connection id. A missing key is "Not set". */
  readonly costs: Readonly<Record<string, Cost>>;
  readonly topUps: readonly TopUp[];
  /** Every figure is shown in this currency. Null until the owner picks one; the browser locale decides then. */
  readonly displayCurrency: Currency | null;
  /** Owner-set rates: units of each currency per 1 USD. USD is always 1. A missing rate leaves that currency out of converted totals. */
  readonly perUsd: Rates;
  /** The day (`YYYY-MM-DD`) the owner last changed a rate, or null when none was ever set. */
  readonly ratesChangedOn: string | null;
}

export const emptyBook: WalletBook = {
  costs: {},
  topUps: [],
  displayCurrency: null,
  perUsd: { USD: 1 },
  ratesChangedOn: null,
};

/** The currency every figure shows in: the owner's choice, else the one the browser locale suggests. */
export function displayCurrencyOf(book: WalletBook, locale: string): Currency {
  return book.displayCurrency ?? defaultCurrency(locale);
}

/** The currencies the owner's entries use, in the usual order. */
export function usedCurrencies(book: WalletBook): readonly Currency[] {
  const used = new Set<Currency>();
  for (const cost of Object.values(book.costs)) {
    if (cost.kind === "paid") used.add(cost.price.currency);
  }
  for (const topUp of book.topUps) {
    if (topUp.price !== null) used.add(topUp.price.currency);
  }
  return currencies.filter((currency) => used.has(currency));
}

/**
 * The currencies that need a rate against USD: every one the book uses and the display currency, since provider
 * spend is in USD. USD itself needs none.
 */
export function rateCurrencies(book: WalletBook, display: Currency): readonly Currency[] {
  const needed = new Set<Currency>([...usedCurrencies(book), display]);
  return currencies.filter((currency) => currency !== "USD" && needed.has(currency));
}

/**
 * An amount ready to show. `shown` is the figure in the display currency, null when a rate is missing.
 * `original` is the amount as entered, set only when its currency is not the display currency. `noRate` names
 * the currency that has no rate when `shown` is null.
 */
export interface Amount {
  readonly shown: Money | null;
  readonly original: Money | null;
  readonly noRate: Currency | null;
}

/** Convert one amount for display. */
export function amountOf(money: Money, display: Currency, rates: Rates): Amount {
  if (money.currency === display) return { shown: money, original: null, noRate: null };
  const shown = convert(money, display, rates);
  return {
    shown,
    original: money,
    noRate: shown === null ? missingRate(money.currency, display, rates) : null,
  };
}

/** A total that may leave some amounts out: `missing` counts amounts with no rate into the display currency. */
export interface Total {
  readonly money: Money;
  readonly missing: number;
}

/** Provider-reported spend in money for this account, or null when the provider reports none. */
export interface UsageSpend {
  readonly money: Money;
  /** What the figure is, for example "Extra usage this month", "On-demand this cycle", "Last 30 days". */
  readonly label: string;
}

/** Usage spend converted for display. */
export interface ShownSpend extends Amount {
  readonly label: string;
}

/** A top-up with its price converted for display; `amount` is null for a free one. */
export interface WalletTopUp extends TopUp {
  readonly amount: Amount | null;
}

/** A list price Headroom suggests when the owner sets a cost. A starting value only; the owner's entry wins. */
export interface PriceSuggestion {
  /** For example "Max 20x". */
  readonly label: string;
  readonly price: Money;
  readonly cycle: Cycle;
  /** `YYYY-MM` the list price was last checked. */
  readonly asOf: string;
}

export interface WalletAccount {
  readonly connection: OverviewConnection;
  /** Null when Not set. */
  readonly cost: Cost | null;
  /** The cost per month (annual / 12); zero for free and included; null when Not set. */
  readonly monthly: Amount | null;
  /** The price as billed, per its cycle; null unless paid. */
  readonly billed: Amount | null;
  /** The next renewal on or after `now` as `YYYY-MM-DD`, or null. */
  readonly nextRenewal: string | null;
  readonly usageSpend: ShownSpend | null;
}

export interface WalletProvider {
  readonly provider: Provider;
  readonly accounts: readonly WalletAccount[];
  /** Paid subscriptions per month in the display currency. */
  readonly monthly: Total;
}

export interface WalletSummary {
  /** The display currency every figure is in. */
  readonly currency: Currency;
  readonly providers: readonly WalletProvider[];
  /** Every paid subscription per month, in the display currency. */
  readonly monthly: Total;
  readonly counts: {
    readonly paid: number;
    readonly free: number;
    readonly included: number;
    readonly notSet: number;
  };
  /** Provider-reported usage spend, in the display currency. */
  readonly usageSpend: Total;
  /** Every top-up, newest first. */
  readonly topUps: readonly WalletTopUp[];
  /** Top-ups dated in the calendar month of `now`: the paid total in the display currency, and the counts. */
  readonly topUpsThisMonth: {
    readonly paid: Total;
    readonly paidCount: number;
    readonly freeCount: number;
    readonly items: readonly WalletTopUp[];
  };
  /** The soonest renewal across paid accounts. */
  readonly nextRenewal: {
    readonly connectionId: string;
    readonly date: string;
    readonly price: Amount;
  } | null;
}

const usd = (dollars: number): Money => ({ minor: toMinor(dollars, "USD"), currency: "USD" });

/** The monthly amount of a cost in its own currency; null when the cost is Not set. */
export function monthlyOf(cost: Cost | null): Money | null {
  if (cost === null) return null;
  if (cost.kind !== "paid") return { minor: 0, currency: "USD" };
  const minor = cost.cycle === "annual" ? Math.round(cost.price.minor / 12) : cost.price.minor;
  return { minor, currency: cost.price.currency };
}

const usageSpendMetrics: Partial<Record<Provider, { key: string; label: string }>> = {
  claude: { key: "extra_usage.used", label: "Extra usage this month" },
  cursor: { key: "on_demand.used", label: "On-demand this cycle" },
  vercel_ai_gateway: { key: "spend.30d", label: "Last 30 days" },
};

/** Usage spend the provider reports in money for this account, or null. */
export function usageSpendOf(connection: OverviewConnection): UsageSpend | null {
  const wanted = usageSpendMetrics[connection.provider];
  if (wanted === undefined) return null;
  const found = connection.snapshot?.metrics.find(
    (metric) => metric.providerMetricKey === wanted.key,
  );
  if (
    found === undefined ||
    found.kind !== "spend" ||
    found.availability !== "available" ||
    found.unit !== "USD" ||
    found.valueNum === null ||
    !Number.isFinite(found.valueNum)
  ) {
    return null;
  }
  return { money: usd(found.valueNum), label: wanted.label };
}

// ---------- list prices ----------

const asOf = "2026-10";

interface CatalogEntry {
  readonly suggestion: PriceSuggestion;
  /** Normalized plan text (lower case, letters and digits only, "+" as "plus") that fits this entry; longer means closer. */
  readonly keys: readonly string[];
  /** Weak fits that rank below any key. */
  readonly loose?: readonly string[];
}

function entry(
  label: string,
  dollars: number,
  cycle: Cycle,
  keys: readonly string[],
  loose?: readonly string[],
): CatalogEntry {
  const base = { suggestion: { label, price: usd(dollars), cycle, asOf }, keys };
  return loose === undefined ? base : { ...base, loose };
}

/** Current USD list prices for consumer plans, checked 2026-10. Business, team and enterprise plans are left out. */
const catalog: Partial<Record<Provider, readonly CatalogEntry[]>> = {
  claude: [
    // https://claude.com/pricing
    entry("Pro", 20, "monthly", ["pro"]),
    entry("Pro annual", 200, "annual", ["pro"]),
    entry("Max 5x", 100, "monthly", ["max5x", "max"]),
    entry("Max 20x", 200, "monthly", ["max20x", "max"]),
  ],
  codex: [
    // https://learn.chatgpt.com/docs/pricing
    entry("Go", 8, "monthly", ["go"]),
    entry("Plus", 20, "monthly", ["plus"]),
    entry("Pro 100", 100, "monthly", ["prolite", "pro100", "pro"]),
    entry("Pro 200", 200, "monthly", ["pro200", "pro"]),
    entry("Pro 500", 500, "monthly", ["pro500", "pro"]),
  ],
  copilot: [
    // https://docs.github.com/en/copilot/get-started/plans
    entry("Pro", 10, "monthly", ["pro"], ["individual"]),
    entry("Pro+", 39, "monthly", ["proplus"], ["individual"]),
    entry("Max", 100, "monthly", ["max"]),
  ],
  cursor: [
    // https://cursor.com/docs/models-and-pricing
    entry("Pro", 20, "monthly", ["pro"]),
    entry("Pro+", 60, "monthly", ["proplus"]),
    entry("Ultra", 200, "monthly", ["ultra"]),
  ],
  grok: [
    // https://x.ai/pricing
    entry("SuperGrok", 30, "monthly", ["supergrok"]),
    entry("SuperGrok Heavy", 300, "monthly", ["supergrokheavy", "heavy"]),
  ],
  antigravity: [
    // https://gemini.google/subscriptions/
    entry("Google AI Pro", 19.99, "monthly", ["googleaipro", "aipro", "pro"]),
    // https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/
    entry("Google AI Ultra 5x", 99.99, "monthly", ["googleaiultra", "aiultra", "ultra"]),
    entry("Google AI Ultra 20x", 199.99, "monthly", ["googleaiultra", "aiultra", "ultra"]),
  ],
};

function normalizePlan(plan: string): string {
  return plan
    .toLowerCase()
    .replaceAll("+", "plus")
    .replaceAll(/[^a-z0-9]/g, "");
}

function fitOf(item: CatalogEntry, plan: string): number {
  const keyed = item.keys.filter((key) => plan.includes(key)).map((key) => key.length);
  if (keyed.length > 0) return Math.max(...keyed);
  return item.loose?.some((key) => plan.includes(key)) === true ? 1 : 0;
}

/**
 * List prices for a provider and its reported plan string, best match first. A null plan returns every option; a plan
 * that fits nothing (a team or enterprise plan, say) returns none. Providers with no catalog return none.
 */
export function suggestPrices(provider: Provider, plan: string | null): readonly PriceSuggestion[] {
  const entries = catalog[provider] ?? [];
  if (plan === null) return entries.map((item) => item.suggestion);
  const normalized = normalizePlan(plan);
  return entries
    .map((item, index) => ({ item, index, fit: fitOf(item, normalized) }))
    .filter((match) => match.fit > 0)
    .toSorted((a, b) => b.fit - a.fit || a.index - b.index)
    .map((match) => match.item.suggestion);
}

// ---------- summary ----------

class Sum {
  minor = 0;
  missing = 0;

  constructor(private readonly currency: Currency) {}

  add(amount: Amount | null): void {
    if (amount === null || amount.shown === null) this.missing += 1;
    else this.minor += amount.shown.minor;
  }

  total(): Total {
    return { money: { minor: this.minor, currency: this.currency }, missing: this.missing };
  }
}

/**
 * Everything the Wallet view shows, in the saved provider order, every figure in the display currency. `now` is
 * epoch milliseconds; `locale` picks the display currency when the owner has not.
 */
export function summarize(
  connections: readonly OverviewConnection[],
  providerOrder: readonly Provider[],
  book: WalletBook,
  now: number,
  locale = "en-US",
): WalletSummary {
  const currency = displayCurrencyOf(book, locale);
  const rates = book.perUsd;
  const today = isoDate(now);
  const month = today.slice(0, 7);
  const zero: Amount = { shown: { minor: 0, currency }, original: null, noRate: null };
  const monthly = new Sum(currency);
  const usageSpend = new Sum(currency);
  const counts = { paid: 0, free: 0, included: 0, notSet: 0 };
  const soonest: { value: WalletSummary["nextRenewal"] } = { value: null };

  const providers = groupByProvider(connections, providerOrder).map((group) => {
    const providerMonthly = new Sum(currency);
    const accounts = group.connections.map((connection): WalletAccount => {
      const cost = book.costs[connection.id] ?? null;
      const spend = usageSpendOf(connection);
      const shownSpend =
        spend === null ? null : { ...amountOf(spend.money, currency, rates), label: spend.label };
      if (cost === null) counts.notSet += 1;
      else counts[cost.kind] += 1;
      let accountMonthly: Amount | null = cost === null ? null : zero;
      let billed: Amount | null = null;
      let renewal: string | null = null;
      if (cost?.kind === "paid") {
        const own = monthlyOf(cost);
        accountMonthly = own === null ? null : amountOf(own, currency, rates);
        billed = amountOf(cost.price, currency, rates);
        providerMonthly.add(accountMonthly);
        monthly.add(accountMonthly);
        renewal = cost.renewsOn === null ? null : rollForward(cost.renewsOn, cost.cycle, today);
        if (renewal !== null && (soonest.value === null || renewal < soonest.value.date)) {
          soonest.value = { connectionId: connection.id, date: renewal, price: billed };
        }
      }
      if (shownSpend !== null) usageSpend.add(shownSpend);
      return {
        connection,
        cost,
        monthly: accountMonthly,
        billed,
        nextRenewal: renewal,
        usageSpend: shownSpend,
      };
    });
    return { provider: group.provider, accounts, monthly: providerMonthly.total() };
  });

  const topUps = book.topUps
    .map((topUp): WalletTopUp => ({
      ...topUp,
      amount:
        topUp.kind === "paid" && topUp.price !== null
          ? amountOf(topUp.price, currency, rates)
          : null,
    }))
    .toSorted((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const thisMonth = topUps.filter((topUp) => topUp.date.startsWith(month));
  const topUpTotal = new Sum(currency);
  let paidCount = 0;
  for (const topUp of thisMonth) {
    if (topUp.kind === "free") continue;
    paidCount += 1;
    topUpTotal.add(topUp.amount);
  }

  return {
    currency,
    providers,
    monthly: monthly.total(),
    counts,
    usageSpend: usageSpend.total(),
    topUps,
    topUpsThisMonth: {
      paid: topUpTotal.total(),
      paidCount,
      freeCount: thisMonth.length - paidCount,
      items: thisMonth,
    },
    nextRenewal: soonest.value,
  };
}
