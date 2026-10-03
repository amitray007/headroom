import { shortDate } from "@headroom/view-model/time";
import {
  currencies,
  type Cost,
  type Currency,
  type TopUp,
  type WalletBook,
} from "@headroom/view-model/wallet";

/** Pure edits and small readers for the Wallet view. Every edit returns a new book. */

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
 * The currency totals show in. With one currency in use that is the one; with several it is the owner's choice
 * when it is among them. With none it is the owner's choice.
 */
export function effectiveCurrency(book: WalletBook): Currency {
  const used = usedCurrencies(book);
  if (used.length === 1 && used[0] !== undefined) return used[0];
  if (used.length === 0 || used.includes(book.displayCurrency)) return book.displayCurrency;
  return used[0] ?? book.displayCurrency;
}

/** Set a cost, or clear it back to Not set with null. */
export function withCost(book: WalletBook, connectionId: string, cost: Cost | null): WalletBook {
  const costs = Object.fromEntries(
    Object.entries(book.costs).filter(([id]) => id !== connectionId),
  );
  return { ...book, costs: cost === null ? costs : { ...costs, [connectionId]: cost } };
}

export function withTopUp(book: WalletBook, topUp: TopUp): WalletBook {
  return { ...book, topUps: [...book.topUps, topUp] };
}

export function withoutTopUp(book: WalletBook, id: string): WalletBook {
  return { ...book, topUps: book.topUps.filter((topUp) => topUp.id !== id) };
}

/** Set the units of a currency per 1 USD, or clear the rate with null. USD stays 1. */
export function withRate(book: WalletBook, currency: Currency, rate: number | null): WalletBook {
  if (currency === "USD") return book;
  const perUsd = Object.fromEntries(
    Object.entries(book.perUsd).filter(([key]) => key !== currency),
  );
  return { ...book, perUsd: rate === null ? perUsd : { ...perUsd, [currency]: rate } };
}

export function withDisplay(book: WalletBook, displayCurrency: Currency): WalletBook {
  return { ...book, displayCurrency };
}

/** Minor units from what the owner typed: digits with up to two decimals, above zero. Null when it does not fit. */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const minor = Math.round(Number(trimmed) * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/** A number above zero from what the owner typed, for rates and credits. Null when it does not fit. */
export function parsePositive(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Minor units as an input value: "200" or "199.99". */
export function amountText(minor: number): string {
  const value = minor / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function parts(day: string): readonly [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** "Oct 12" for `2026-10-12`. */
export function dayLabel(day: string): string {
  const at = parts(day);
  return at === null ? day : shortDate(new Date(at[0], at[1] - 1, at[2]).getTime());
}

/** "Oct 2026" for `2026-10`. */
export function monthLabel(month: string): string {
  const at = /^(\d{4})-(\d{2})$/.exec(month);
  if (at === null) return month;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(at[1]), Number(at[2]) - 1, 1)));
}

/** Today in the owner's time zone as `YYYY-MM-DD`. */
export function dayOf(t: number): string {
  const date = new Date(t);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** An id for a new top-up. `randomUUID` needs a secure page, and this app may be opened over plain HTTP. */
export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
