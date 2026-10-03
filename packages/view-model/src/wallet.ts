import type { Provider } from "@headroom/core/contracts";

import { groupByProvider } from "./labels.ts";
import type { OverviewConnection } from "./overview.ts";

/**
 * Wallet: what the owner pays for each account, in money. Exploration on the `wallet-exploration` branch.
 * Providers never report what an account costs, so every cost and top-up here is owner-entered; only usage spend
 * (Claude extra usage, Cursor on-demand, Vercel 30-day spend) comes from the provider's own figures.
 */

export const currencies = ["USD", "EUR", "GBP", "INR"] as const;
export type Currency = (typeof currencies)[number];

export type Cycle = "monthly" | "annual";

/** An amount in minor units (cents, paise) with its currency. Never mixed with credits or percentages. */
export interface Money {
  readonly minor: number;
  readonly currency: Currency;
}

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
  /** Totals are shown in this currency. */
  readonly displayCurrency: Currency;
  /** Owner-set rates: units of each currency per 1 USD. USD is always 1. A missing rate leaves that currency out of converted totals. */
  readonly perUsd: Readonly<Partial<Record<Currency, number>>>;
}

export const emptyBook: WalletBook = {
  costs: {},
  topUps: [],
  displayCurrency: "USD",
  perUsd: { USD: 1 },
};

/** A total that may leave some amounts out: `missing` counts amounts with no rate into the display currency. */
export interface Total {
  readonly money: Money;
  readonly missing: number;
}

/** Provider-reported spend in money for this account, or null when the provider reports none. */
export interface UsageSpend {
  readonly money: Money;
  /** For example "Extra usage this month", "On-demand this cycle", "Last 30 days". */
  readonly label: string;
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
  /** The cost per month in its own currency (annual / 12); zero for free and included; null when Not set. */
  readonly monthly: Money | null;
  /** The next renewal on or after `now` as `YYYY-MM-DD`, or null. */
  readonly nextRenewal: string | null;
  readonly usageSpend: UsageSpend | null;
  readonly topUps: readonly TopUp[];
}

export interface WalletProvider {
  readonly provider: Provider;
  readonly accounts: readonly WalletAccount[];
  /** Paid subscriptions per month in the display currency. */
  readonly monthly: Total;
}

export interface WalletSummary {
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
  /** Paid top-ups dated in the calendar month of `now`, in the display currency, and how many free ones. */
  readonly topUpsThisMonth: { readonly paid: Total; readonly freeCount: number };
  /** The soonest renewal across paid accounts. */
  readonly nextRenewal: {
    readonly connectionId: string;
    readonly date: string;
    readonly price: Money;
  } | null;
}

const usd = (dollars: number): Money => ({ minor: Math.round(dollars * 100), currency: "USD" });

/** The monthly amount of a cost in its own currency; null when the cost is Not set. */
export function monthlyOf(cost: Cost | null): Money | null {
  if (cost === null) return null;
  if (cost.kind !== "paid") return { minor: 0, currency: "USD" };
  const minor = cost.cycle === "annual" ? Math.round(cost.price.minor / 12) : cost.price.minor;
  return { minor, currency: cost.price.currency };
}

function rateOf(currency: Currency, perUsd: WalletBook["perUsd"]): number | null {
  if (currency === "USD") return 1;
  const rate = perUsd[currency];
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** Convert through USD with the owner's rates; null when either rate is missing. */
export function convert(money: Money, to: Currency, perUsd: WalletBook["perUsd"]): Money | null {
  if (money.currency === to) return money;
  const from = rateOf(money.currency, perUsd);
  const target = rateOf(to, perUsd);
  if (from === null || target === null) return null;
  return { minor: Math.round((money.minor / from) * target), currency: to };
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

// ---------- dates ----------

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parse `YYYY-MM-DD` into numbers; null when it is not a real date. */
function parseDate(text: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const [year, month, dayOfMonth] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, dayOfMonth));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === dayOfMonth
    ? { year, month, day: dayOfMonth }
    : null;
}

/** The date `months` after the start, keeping the start's day of month and clamping to the month's end. */
function addMonths(start: { year: number; month: number; day: number }, months: number): string {
  const index = start.year * 12 + (start.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const value = new Date(Date.UTC(year, month, Math.min(start.day, lastDay)));
  return value.toISOString().slice(0, 10);
}

/** Roll a renewal date forward by its cycle until it is on or after `today` (`YYYY-MM-DD`). */
function rollForward(renewsOn: string, cycle: Cycle, today: string): string | null {
  const start = parseDate(renewsOn);
  if (start === null) return null;
  const step = cycle === "annual" ? 12 : 1;
  let next = addMonths(start, 0);
  for (let count = 1; next < today; count += 1) next = addMonths(start, count * step);
  return next;
}

// ---------- summary ----------

class Sum {
  minor = 0;
  missing = 0;

  constructor(private readonly currency: Currency) {}

  add(money: Money | null, perUsd: WalletBook["perUsd"]): void {
    const converted = money === null ? null : convert(money, this.currency, perUsd);
    if (converted === null) this.missing += 1;
    else this.minor += converted.minor;
  }

  total(): Total {
    return { money: { minor: this.minor, currency: this.currency }, missing: this.missing };
  }
}

/** Everything the Wallet view shows, in the saved provider order. `now` is epoch milliseconds. */
export function summarize(
  connections: readonly OverviewConnection[],
  providerOrder: readonly Provider[],
  book: WalletBook,
  now: number,
): WalletSummary {
  const currency = book.displayCurrency;
  const today = isoDate(now);
  const month = today.slice(0, 7);
  const monthly = new Sum(currency);
  const usageSpend = new Sum(currency);
  const counts = { paid: 0, free: 0, included: 0, notSet: 0 };
  const soonest: { value: WalletSummary["nextRenewal"] } = { value: null };

  const providers = groupByProvider(connections, providerOrder).map((group) => {
    const providerMonthly = new Sum(currency);
    const accounts = group.connections.map((connection): WalletAccount => {
      const cost = book.costs[connection.id] ?? null;
      const accountMonthly = monthlyOf(cost);
      const renewal =
        cost?.kind === "paid" && cost.renewsOn !== null
          ? rollForward(cost.renewsOn, cost.cycle, today)
          : null;
      const spend = usageSpendOf(connection);
      if (cost === null) counts.notSet += 1;
      else counts[cost.kind] += 1;
      if (cost?.kind === "paid") {
        providerMonthly.add(accountMonthly, book.perUsd);
        monthly.add(accountMonthly, book.perUsd);
        if (renewal !== null && (soonest.value === null || renewal < soonest.value.date)) {
          soonest.value = { connectionId: connection.id, date: renewal, price: cost.price };
        }
      }
      if (spend !== null) usageSpend.add(spend.money, book.perUsd);
      return {
        connection,
        cost,
        monthly: accountMonthly,
        nextRenewal: renewal,
        usageSpend: spend,
        topUps: book.topUps
          .filter((topUp) => topUp.connectionId === connection.id)
          .toSorted((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
      };
    });
    return { provider: group.provider, accounts, monthly: providerMonthly.total() };
  });

  const topUpTotal = new Sum(currency);
  let freeCount = 0;
  for (const topUp of book.topUps) {
    if (!topUp.date.startsWith(month)) continue;
    if (topUp.kind === "free") freeCount += 1;
    else topUpTotal.add(topUp.price, book.perUsd);
  }

  return {
    providers,
    monthly: monthly.total(),
    counts,
    usageSpend: usageSpend.total(),
    topUpsThisMonth: { paid: topUpTotal.total(), freeCount },
    nextRenewal: soonest.value,
  };
}

const locales: Record<Currency, string> = {
  USD: "en-US",
  EUR: "en-US",
  GBP: "en-US",
  INR: "en-IN",
};

/** Format money for display, for example "$200", "$1,128.10", "₹1,999". Whole amounts drop the decimals. */
export function formatMoney(money: Money): string {
  const digits = money.minor % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locales[money.currency], {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(money.minor / 100);
}
