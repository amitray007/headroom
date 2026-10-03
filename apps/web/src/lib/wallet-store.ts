import { useCallback, useSyncExternalStore } from "react";

import {
  currencies,
  emptyBook,
  type Cost,
  type Currency,
  type Money,
  type TopUp,
  type WalletBook,
} from "@headroom/view-model/wallet";

import { browserStorage } from "./device-prefs.ts";

/**
 * The owner's Wallet entries. Exploration: they live in this browser only, under one localStorage key as JSON.
 * Demo Mode has its own in-memory book, so its edits never touch the saved one.
 */
export const walletKey = "headroom.wallet";

type WalletStorage = Pick<Storage, "getItem" | "setItem">;

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCurrency(value: unknown): Currency | null {
  return currencies.find((currency) => currency === value) ?? null;
}

function readMoney(value: unknown): Money | null {
  if (!isRecord(value)) return null;
  const currency = readCurrency(value["currency"]);
  const minor = value["minor"];
  if (
    currency === null ||
    typeof minor !== "number" ||
    !Number.isSafeInteger(minor) ||
    minor <= 0
  ) {
    return null;
  }
  return { minor, currency };
}

function readCost(value: unknown): Cost | null {
  if (!isRecord(value)) return null;
  if (value["kind"] === "free") return { kind: "free" };
  if (value["kind"] === "included") {
    const includedWith = value["includedWith"];
    return typeof includedWith === "string" ? { kind: "included", includedWith } : null;
  }
  if (value["kind"] !== "paid") return null;
  const price = readMoney(value["price"]);
  const cycle = value["cycle"];
  const renewsOn = value["renewsOn"];
  if (price === null || (cycle !== "monthly" && cycle !== "annual")) return null;
  if (renewsOn !== null && !(typeof renewsOn === "string" && dayPattern.test(renewsOn)))
    return null;
  return { kind: "paid", price, cycle, renewsOn };
}

function readTopUp(value: unknown): TopUp | null {
  if (!isRecord(value)) return null;
  const { id, connectionId, date, kind, credits, note } = value;
  if (typeof id !== "string" || typeof connectionId !== "string") return null;
  if (typeof date !== "string" || !dayPattern.test(date)) return null;
  if (kind !== "paid" && kind !== "free") return null;
  const price = kind === "paid" ? readMoney(value["price"]) : null;
  if (kind === "paid" && price === null) return null;
  return {
    id,
    connectionId,
    date,
    kind,
    price,
    credits:
      typeof credits === "number" && Number.isFinite(credits) && credits > 0 ? credits : null,
    note: typeof note === "string" && note !== "" ? note : null,
  };
}

/** Read saved JSON loosely: entries that do not fit are dropped, and a value that is not a book is an empty one. */
export function parseBook(text: string | null): WalletBook {
  if (text === null) return emptyBook;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyBook;
  }
  if (!isRecord(parsed)) return emptyBook;
  const costs: Record<string, Cost> = {};
  if (isRecord(parsed["costs"])) {
    for (const [id, entry] of Object.entries(parsed["costs"])) {
      const cost = readCost(entry);
      if (cost !== null) costs[id] = cost;
    }
  }
  const topUps = Array.isArray(parsed["topUps"])
    ? parsed["topUps"].flatMap((entry) => {
        const topUp = readTopUp(entry);
        return topUp === null ? [] : [topUp];
      })
    : [];
  const perUsd: Partial<Record<Currency, number>> = { USD: 1 };
  if (isRecord(parsed["perUsd"])) {
    for (const currency of currencies) {
      const rate = parsed["perUsd"][currency];
      if (currency !== "USD" && typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        perUsd[currency] = rate;
      }
    }
  }
  return {
    costs,
    topUps,
    displayCurrency: readCurrency(parsed["displayCurrency"]) ?? "USD",
    perUsd,
  };
}

export function readBook(storage: Pick<Storage, "getItem">): WalletBook {
  return parseBook(storage.getItem(walletKey));
}

export function saveBook(storage: Pick<Storage, "setItem">, book: WalletBook): void {
  storage.setItem(walletKey, JSON.stringify(book));
}

export interface WalletStore {
  subscribe: (listener: () => void) => () => void;
  /** The saved book. */
  real: () => WalletBook;
  /** Replace and save the book. */
  setReal: (book: WalletBook) => void;
  /** The in-memory Demo Mode book for `key`, made on first use. A new key starts a new book. */
  demo: (key: string, make: () => WalletBook) => WalletBook;
  /** Replace the Demo Mode book. Nothing is saved. */
  setDemo: (key: string, book: WalletBook) => void;
}

/** The book outside React: one saved book and one in-memory demo book, shared by every reader. */
export function createWalletStore(storage: WalletStorage | null): WalletStore {
  let saved = storage === null ? emptyBook : readBook(storage);
  let demo: { readonly key: string; readonly book: WalletBook } | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    real: () => saved,
    setReal(book) {
      saved = book;
      try {
        if (storage !== null) saveBook(storage, book);
      } catch {
        // A full or blocked storage keeps the entry for this page load only.
      }
      notify();
    },
    demo(key, make) {
      if (demo?.key !== key) demo = { key, book: make() };
      return demo.book;
    },
    setDemo(key, book) {
      demo = { key, book };
      notify();
    },
  };
}

let shared: WalletStore | null = null;

function walletStore(): WalletStore {
  shared ??= createWalletStore(browserStorage());
  return shared;
}

/** How to build the Demo Mode book. `key` changes when Demo Mode starts over. */
export interface DemoSource {
  readonly key: string;
  readonly make: () => WalletBook;
}

/** The book to show and a way to replace it. With a `demo` source it is the in-memory demo book. */
export function useWalletBook(
  demo: DemoSource | null,
): readonly [WalletBook, (next: WalletBook) => void] {
  const store = walletStore();
  const read = (): WalletBook => (demo === null ? store.real() : store.demo(demo.key, demo.make));
  const book = useSyncExternalStore(store.subscribe, read, read);
  const key = demo?.key ?? null;
  const replace = useCallback(
    (next: WalletBook): void => {
      if (key === null) store.setReal(next);
      else store.setDemo(key, next);
    },
    [store, key],
  );
  return [book, replace];
}
