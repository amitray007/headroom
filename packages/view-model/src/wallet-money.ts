/**
 * Money for the Wallet: the supported currencies, minor units, conversion through exchange rates and
 * formatting. Minor-unit digits come from Intl (JPY has none, most have two), never a fixed 2.
 */

export const currencies = [
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
] as const;
export type Currency = (typeof currencies)[number];

/** An amount in minor units (cents, paise, whole yen) with its currency. Never mixed with credits or percentages. */
export interface Money {
  readonly minor: number;
  readonly currency: Currency;
}

/** Exchange rates: units of each currency per 1 USD. USD is always 1. A missing rate leaves that currency out. */
export type Rates = Readonly<Partial<Record<Currency, number>>>;

const names: Record<Currency, string> = {
  USD: "US dollar",
  EUR: "Euro",
  GBP: "British pound",
  INR: "Indian rupee",
  CAD: "Canadian dollar",
  AUD: "Australian dollar",
  JPY: "Japanese yen",
  SGD: "Singapore dollar",
  CHF: "Swiss franc",
  BRL: "Brazilian real",
};

/** The English name; a code outside the Wallet list falls back to Intl, then to the code. */
export function currencyName(currency: string): string {
  const known = (names as Readonly<Record<string, string>>)[currency];
  if (known !== undefined) return known;
  try {
    return new Intl.DisplayNames("en-US", { type: "currency" }).of(currency) ?? currency;
  } catch {
    return currency;
  }
}

const digitsCache = new Map<string, number>();

/** How many decimal digits the minor unit of a currency has: 2 for USD, 0 for JPY. */
export function minorDigits(currency: string): number {
  let digits = digitsCache.get(currency);
  if (digits === undefined) {
    digits =
      new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    digitsCache.set(currency, digits);
  }
  return digits;
}

/** The minor units of an amount in major units (dollars, rupees, yen), rounded. */
export function toMinor(major: number, currency: Currency): number {
  return Math.round(major * 10 ** minorDigits(currency));
}

const symbolCache = new Map<string, string>();

/** The symbol that tells this currency apart: "$", "₹", "CA$", "CHF". */
export function currencySymbol(currency: string): string {
  let symbol = symbolCache.get(currency);
  if (symbol === undefined) {
    const parts = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(1);
    symbol = parts.find((part) => part.type === "currency")?.value ?? currency;
    symbolCache.set(currency, symbol);
  }
  return symbol;
}

const regionCurrency: Readonly<Record<string, Currency>> = {
  IN: "INR",
  GB: "GBP",
  CA: "CAD",
  AU: "AUD",
  JP: "JPY",
  SG: "SGD",
  CH: "CHF",
  BR: "BRL",
  ...Object.fromEntries(
    [
      "AT",
      "BE",
      "CY",
      "DE",
      "EE",
      "ES",
      "FI",
      "FR",
      "GR",
      "HR",
      "IE",
      "IT",
      "LT",
      "LU",
      "LV",
      "MT",
      "NL",
      "PT",
      "SI",
      "SK",
    ].map((region) => [region, "EUR"]),
  ),
};

/** The currency a browser locale suggests when the owner has not chosen one: "en-IN" is INR, "de-DE" EUR, else USD. */
export function defaultCurrency(locale: string): Currency {
  let region: string | undefined;
  try {
    region = new Intl.Locale(locale).region;
  } catch {
    return "USD";
  }
  return (region === undefined ? undefined : regionCurrency[region]) ?? "USD";
}

function rateOf(currency: Currency, rates: Rates): number | null {
  if (currency === "USD") return 1;
  const rate = rates[currency];
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/** The first of the two currencies that has no usable rate, or null when both have one. */
export function missingRate(from: Currency, to: Currency, rates: Rates): Currency | null {
  if (rateOf(from, rates) === null) return from;
  return rateOf(to, rates) === null ? to : null;
}

/** Convert through USD with the given rates; null when either rate is missing. */
export function convert(money: Money, to: Currency, rates: Rates): Money | null {
  if (money.currency === to) return money;
  const from = rateOf(money.currency, rates);
  const target = rateOf(to, rates);
  if (from === null || target === null) return null;
  const major = money.minor / 10 ** minorDigits(money.currency) / from;
  return { minor: toMinor(major * target, to), currency: to };
}

/** Format money for display: "$200", "$1,128.10", "₹1,999", "¥1,500". Whole amounts drop the decimals. */
export function formatMoney(money: Money): string {
  const unit = 10 ** minorDigits(money.currency);
  const digits = money.minor % unit === 0 ? 0 : minorDigits(money.currency);
  return new Intl.NumberFormat(money.currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(money.minor / unit);
}

/** A number above zero from what the owner typed, for rates and credits. Null when it does not fit. */
export function parsePositive(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : null;
}
