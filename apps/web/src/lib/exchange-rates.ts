import { useSyncExternalStore } from "react";

import { currencies, type Currency } from "@headroom/view-model/wallet-money";

import { api, type ExchangeRatesPayload } from "../api.ts";

/**
 * Exchange rates the server fetches from the European Central Bank's daily reference rates (via Frankfurter) and
 * refreshes every 24 hours. The browser only reads them.
 */
export interface ExchangeRates {
  /** Units of each currency per 1 USD; USD is always 1. Null until the first load, or when none could be fetched. */
  readonly perUsd: Readonly<Partial<Record<Currency, number>>> | null;
  /** The reference date the rates are for, `YYYY-MM-DD`; null before the first fetch. */
  readonly date: string | null;
  /** When the server last fetched them, epoch milliseconds; null before the first fetch. */
  readonly fetchedAt: number | null;
  readonly status: "loading" | "ready" | "refreshing" | "failed";
  /** The last fetch failed; older rates may still be in use. */
  readonly error: string | null;
}

/** A page that comes back to the foreground after more than this reads the rates again. */
const staleAfterMs = 60 * 60_000;

const unreachable = "Could not reach the server.";

interface RatesClient {
  exchangeRates: () => Promise<ExchangeRatesPayload>;
  refreshExchangeRates: () => Promise<ExchangeRatesPayload>;
}

/** The slice of `document` the store watches: tests pass a fake, a server render passes none. */
interface Visibility {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface ExchangeRatesStore {
  getState: () => ExchangeRates;
  /** Ask the server to fetch the rates again now. Never rejects: a failure lands in `error`. */
  refresh: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

function supported(
  perUsd: Readonly<Record<string, number>> | null,
): Readonly<Partial<Record<Currency, number>>> | null {
  if (perUsd === null) return null;
  const known: Partial<Record<Currency, number>> = {};
  for (const currency of currencies) {
    const rate = perUsd[currency];
    if (rate !== undefined && rate > 0) known[currency] = rate;
  }
  return known;
}

/** The rates outside React: loaded on the first subscriber, read again when the page returns after an hour away. */
export function createExchangeRatesStore(
  client: RatesClient = api,
  options: {
    readonly now?: () => number;
    readonly visibility?: Visibility | null;
  } = {},
): ExchangeRatesStore {
  const now = options.now ?? Date.now;
  const visibility =
    options.visibility === undefined
      ? typeof document === "undefined"
        ? null
        : document
      : options.visibility;
  const listeners = new Set<() => void>();
  let reading: Promise<void> | null = null;
  let lastReadAt: number | null = null;

  const read = (): void => {
    if (reading !== null) return;
    reading = run(client.exchangeRates).finally(() => {
      reading = null;
    });
  };
  let state: ExchangeRates = {
    perUsd: null,
    date: null,
    fetchedAt: null,
    status: "loading",
    error: null,
  };
  const set = (next: Partial<ExchangeRates>): void => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  /** One call to the server. A failed call keeps the rates already shown and records the error. */
  async function run(call: () => Promise<ExchangeRatesPayload>): Promise<void> {
    if (state.status !== "loading") set({ status: "refreshing" });
    try {
      const payload = await call();
      lastReadAt = now();
      const perUsd = supported(payload.perUsd);
      set({
        perUsd,
        date: payload.date,
        fetchedAt: payload.fetchedAt,
        error: payload.error,
        status: perUsd === null ? "failed" : "ready",
      });
    } catch {
      set({ error: unreachable, status: state.perUsd === null ? "failed" : "ready" });
    }
  }

  const onVisible = (): void => {
    if (visibility?.visibilityState !== "visible") return;
    if (lastReadAt !== null && now() - lastReadAt <= staleAfterMs) return;
    read();
  };

  return {
    getState: () => state,
    refresh: () => reading ?? run(client.refreshExchangeRates),
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        visibility?.addEventListener("visibilitychange", onVisible);
        if (lastReadAt === null) read();
        else onVisible();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) visibility?.removeEventListener("visibilitychange", onVisible);
      };
    },
  };
}

const store = createExchangeRatesStore();

export const refreshExchangeRates = store.refresh;

export function useExchangeRates(): ExchangeRates {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
