import type { Provider } from "@headroom/core/contracts";

import { groupByProvider } from "./labels.ts";
import type { OverviewConnection } from "./overview.ts";
import { addDays, isoDate, rollForward, shiftMonth, type Cycle } from "./wallet-dates.ts";
import {
  convert,
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
}

export const emptyBook: WalletBook = {
  costs: {},
  topUps: [],
  displayCurrency: null,
};

/** The currency every figure shows in: the owner's choice, else the one the browser locale suggests. */
export function displayCurrencyOf(book: WalletBook, locale: string): Currency {
  return book.displayCurrency ?? defaultCurrency(locale);
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

/**
 * What an account holds in provider credits. Never money: `balance` counts the provider's own credits and is not
 * converted, and `resets` counts banked full resets.
 */
export interface AccountCredits {
  /** Null when the provider reports no balance. A null `value` with `unlimited` false is not possible. */
  readonly balance: {
    /** Null when the balance is unlimited. */
    readonly value: number | null;
    readonly unlimited: boolean;
  } | null;
  /** Banked full resets above zero, or null when none are reported or none are banked. */
  readonly resets: number | null;
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
  /** Provider credits and banked resets, in the provider's own units; null when the provider reports none. */
  readonly credits: AccountCredits | null;
}

export interface WalletProvider {
  readonly provider: Provider;
  readonly accounts: readonly WalletAccount[];
  /** Paid subscriptions per month in the display currency. */
  readonly monthly: Total;
  /** Provider-reported usage spend across the provider's accounts, in the display currency. */
  readonly usageSpend: Total;
}

/** Paid top-ups dated in one calendar month, in the display currency. */
export interface MonthTotal {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly paid: Total;
}

/** A paid account's next renewal inside a window of days. `price` is what the renewal bills, per its cycle. */
export interface Renewal {
  readonly connectionId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly price: Amount;
}

export interface WalletSummary {
  /** The display currency every figure is in. */
  readonly currency: Currency;
  /** The day the summary was made for, `YYYY-MM-DD`. */
  readonly today: string;
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
  /** Subscriptions per month, usage spend and this month's paid top-ups, in the display currency. */
  readonly allIn: Total;
  /** Every top-up, newest first. */
  readonly topUps: readonly WalletTopUp[];
  /** Top-ups dated in the calendar month of `now`: the paid total in the display currency, and the counts. */
  readonly topUpsThisMonth: {
    readonly paid: Total;
    readonly paidCount: number;
    readonly freeCount: number;
    readonly items: readonly WalletTopUp[];
  };
  /** Paid top-ups per calendar month for the last `topUpMonthCount` months, oldest first, the current month last. */
  readonly topUpMonths: readonly MonthTotal[];
  /** Renewals in the next `renewalWindowDays` days from today, soonest first. */
  readonly renewals: readonly Renewal[];
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

const creditBalanceKeys: Partial<Record<Provider, string>> = {
  codex: "credits.balance",
  grok: "prepaid_balance",
  vercel_ai_gateway: "credits.balance",
};

const resetKeys: Partial<Record<Provider, string>> = {
  codex: "reset_credits.available_count",
  claude: "reset_grants.available",
};

/**
 * The provider credits an account holds: Codex credit balance and banked resets, Claude reset grants, Grok
 * prepaid balance, Vercel AI Gateway credit balance. Null when the provider reports none. An unreported figure is
 * left out, never zero.
 */
export function creditsOf(connection: OverviewConnection): AccountCredits | null {
  const metrics = connection.snapshot?.metrics ?? [];
  const balanceKey = creditBalanceKeys[connection.provider];
  const found =
    balanceKey === undefined
      ? undefined
      : metrics.find((metric) => metric.providerMetricKey === balanceKey);
  let balance: AccountCredits["balance"] = null;
  if (found !== undefined && found.kind === "credits" && found.availability === "available") {
    if (found.unlimited === true) balance = { value: null, unlimited: true };
    else if (found.valueNum !== null && Number.isFinite(found.valueNum)) {
      balance = { value: found.valueNum, unlimited: false };
    }
  }
  const resetKey = resetKeys[connection.provider];
  const reported =
    resetKey === undefined
      ? undefined
      : metrics.find((metric) => metric.providerMetricKey === resetKey);
  const stored = connection.snapshot?.resetCredits ?? [];
  let count: number | null = null;
  if (reported !== undefined) {
    if (
      reported.kind === "reset_inventory" &&
      reported.availability === "available" &&
      reported.valueNum !== null &&
      Number.isFinite(reported.valueNum)
    ) {
      count = reported.valueNum;
    }
  } else if (resetKey !== undefined && stored.length > 0) {
    count = stored.filter((credit) => credit.usable).length;
  }
  const resets = count !== null && count > 0 ? count : null;
  return balance === null && resets === null ? null : { balance, resets };
}

/** "1,128 credits", "1 credit", "40.45 credits", "Unlimited credits". Two decimals only when the balance has a fraction. */
export function creditBalanceText(balance: NonNullable<AccountCredits["balance"]>): string {
  if (balance.value === null) return "Unlimited credits";
  const decimals = Number.isInteger(balance.value) ? 0 : 2;
  const number = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(balance.value);
  return `${number} ${balance.value === 1 ? "credit" : "credits"}`;
}

/** "2 resets banked", "1 reset banked". */
export function bankedText(resets: number): string {
  return `${resets} ${resets === 1 ? "reset" : "resets"} banked`;
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

/** Months in `WalletSummary.topUpMonths`, the current one included. */
export const topUpMonthCount = 6;
/** Days in `WalletSummary.renewals`, today included. */
export const renewalWindowDays = 30;

/**
 * Paid top-ups per calendar month for the `count` months ending with the month of `today`, oldest first, in the
 * display currency. A month with none totals zero; a price with no rate is left out and counted in `missing`.
 */
export function topUpMonths(
  topUps: readonly WalletTopUp[],
  today: string,
  count: number,
  currency: Currency,
): readonly MonthTotal[] {
  const current = today.slice(0, 7);
  return Array.from({ length: count }, (_, index) => {
    const month = shiftMonth(current, index - (count - 1));
    const sum = new Sum(currency);
    for (const topUp of topUps) {
      if (topUp.kind === "paid" && topUp.date.startsWith(month)) sum.add(topUp.amount);
    }
    return { month, paid: sum.total() };
  });
}

/**
 * The next renewal of every paid account that falls in the `days` days starting today (today included), soonest
 * first. An account with no renewal date is left out.
 */
export function upcomingRenewals(
  providers: readonly WalletProvider[],
  today: string,
  days: number,
): readonly Renewal[] {
  const last = addDays(today, days - 1);
  if (last === null) return [];
  return providers
    .flatMap((group) => group.accounts)
    .flatMap((account): Renewal[] =>
      account.nextRenewal !== null &&
      account.billed !== null &&
      account.nextRenewal >= today &&
      account.nextRenewal <= last
        ? [
            {
              connectionId: account.connection.id,
              date: account.nextRenewal,
              price: account.billed,
            },
          ]
        : [],
    )
    .toSorted((a, b) => a.date.localeCompare(b.date));
}

/** One provider's money this month, in display-currency minor units, split by kind. */
export interface ProviderSpend {
  readonly provider: Provider;
  /** Paid subscriptions per month. */
  readonly plan: number;
  /** Provider-reported usage spend. */
  readonly usage: number;
  /** Paid top-ups dated this month. */
  readonly topUps: number;
  readonly total: number;
}

/**
 * Where this month's all-in money goes: each provider's plans, usage spend and paid top-ups, largest total first
 * (equal totals keep provider order). A provider with nothing above zero is left out; amounts with no rate are
 * already outside the totals, so the parts add up to `allIn`.
 */
export function providerSpend(summary: WalletSummary): readonly ProviderSpend[] {
  const providerOf = new Map(
    summary.providers.flatMap((group) =>
      group.accounts.map((account) => [account.connection.id, group.provider] as const),
    ),
  );
  const topUps = new Map<Provider, number>();
  for (const item of summary.topUpsThisMonth.items) {
    const provider = providerOf.get(item.connectionId);
    const minor = item.amount?.shown?.minor ?? 0;
    if (provider !== undefined && minor > 0)
      topUps.set(provider, (topUps.get(provider) ?? 0) + minor);
  }
  return summary.providers
    .map((group) => {
      const plan = group.monthly.money.minor;
      const usage = group.usageSpend.money.minor;
      const topUp = topUps.get(group.provider) ?? 0;
      return { provider: group.provider, plan, usage, topUps: topUp, total: plan + usage + topUp };
    })
    .filter((part) => part.total > 0)
    .toSorted((a, b) => b.total - a.total);
}

/**
 * Everything the Wallet view shows, in the saved provider order, every figure in the display currency. `rates` are
 * the server's units per 1 USD (null when none are known, so other-currency amounts count as missing). `now` is
 * epoch milliseconds; `locale` picks the display currency when the owner has not.
 */
export function summarize(
  connections: readonly OverviewConnection[],
  providerOrder: readonly Provider[],
  book: WalletBook,
  rates: Rates | null,
  now: number,
  locale = "en-US",
): WalletSummary {
  const currency = displayCurrencyOf(book, locale);
  // No rates at all: only USD converts, and only to itself, so every other-currency amount counts as missing.
  const rate: Rates = rates ?? {};
  const today = isoDate(now);
  const month = today.slice(0, 7);
  const zero: Amount = { shown: { minor: 0, currency }, original: null, noRate: null };
  const monthly = new Sum(currency);
  const usageSpend = new Sum(currency);
  const counts = { paid: 0, free: 0, included: 0, notSet: 0 };
  const soonest: { value: WalletSummary["nextRenewal"] } = { value: null };

  const providers = groupByProvider(connections, providerOrder).map((group) => {
    const providerMonthly = new Sum(currency);
    const providerUsage = new Sum(currency);
    const accounts = group.connections.map((connection): WalletAccount => {
      const cost = book.costs[connection.id] ?? null;
      const spend = usageSpendOf(connection);
      const shownSpend =
        spend === null ? null : { ...amountOf(spend.money, currency, rate), label: spend.label };
      if (cost === null) counts.notSet += 1;
      else counts[cost.kind] += 1;
      let accountMonthly: Amount | null = cost === null ? null : zero;
      let billed: Amount | null = null;
      let renewal: string | null = null;
      if (cost?.kind === "paid") {
        const own = monthlyOf(cost);
        accountMonthly = own === null ? null : amountOf(own, currency, rate);
        billed = amountOf(cost.price, currency, rate);
        providerMonthly.add(accountMonthly);
        monthly.add(accountMonthly);
        renewal = cost.renewsOn === null ? null : rollForward(cost.renewsOn, cost.cycle, today);
        if (renewal !== null && (soonest.value === null || renewal < soonest.value.date)) {
          soonest.value = { connectionId: connection.id, date: renewal, price: billed };
        }
      }
      if (shownSpend !== null) {
        usageSpend.add(shownSpend);
        providerUsage.add(shownSpend);
      }
      return {
        connection,
        cost,
        monthly: accountMonthly,
        billed,
        nextRenewal: renewal,
        usageSpend: shownSpend,
        credits: creditsOf(connection),
      };
    });
    return {
      provider: group.provider,
      accounts,
      monthly: providerMonthly.total(),
      usageSpend: providerUsage.total(),
    };
  });

  const topUps = book.topUps
    .map((topUp): WalletTopUp => ({
      ...topUp,
      amount:
        topUp.kind === "paid" && topUp.price !== null
          ? amountOf(topUp.price, currency, rate)
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

  const monthlyTotal = monthly.total();
  const usageSpendTotal = usageSpend.total();
  const paidTopUps = topUpTotal.total();

  return {
    currency,
    today,
    providers,
    monthly: monthlyTotal,
    counts,
    usageSpend: usageSpendTotal,
    allIn: {
      money: {
        minor: monthlyTotal.money.minor + usageSpendTotal.money.minor + paidTopUps.money.minor,
        currency,
      },
      missing: monthlyTotal.missing + usageSpendTotal.missing + paidTopUps.missing,
    },
    topUps,
    topUpsThisMonth: {
      paid: paidTopUps,
      paidCount,
      freeCount: thisMonth.length - paidCount,
      items: thisMonth,
    },
    topUpMonths: topUpMonths(topUps, today, topUpMonthCount, currency),
    renewals: upcomingRenewals(providers, today, renewalWindowDays),
    nextRenewal: soonest.value,
  };
}
