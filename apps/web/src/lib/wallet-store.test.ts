import { describe, expect, test } from "bun:test";

import { emptyBook, type WalletBook } from "@headroom/view-model/wallet";

import { createWalletStore, parseBook, readBook, saveBook, walletKey } from "./wallet-store.ts";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const book: WalletBook = {
  costs: {
    a: {
      kind: "paid",
      price: { minor: 20000, currency: "USD" },
      cycle: "monthly",
      renewsOn: "2026-10-12",
    },
    b: { kind: "free" },
    c: { kind: "included", includedWith: "X Premium" },
  },
  topUps: [
    {
      id: "t1",
      connectionId: "a",
      date: "2026-10-01",
      kind: "paid",
      price: { minor: 2500, currency: "EUR" },
      credits: 1000,
      note: "Spring",
    },
    {
      id: "t2",
      connectionId: "b",
      date: "2026-10-02",
      kind: "free",
      price: null,
      credits: null,
      note: null,
    },
  ],
  displayCurrency: "EUR",
  perUsd: { USD: 1, EUR: 0.92 },
};

describe("parseBook", () => {
  test("a missing, broken or foreign value is the empty book", () => {
    expect(parseBook(null)).toBe(emptyBook);
    expect(parseBook("{not json")).toBe(emptyBook);
    expect(parseBook("[1,2]")).toBe(emptyBook);
    expect(parseBook('"text"')).toBe(emptyBook);
    expect(parseBook("null")).toBe(emptyBook);
  });
  test("drops entries that do not fit and keeps the rest", () => {
    const loose = parseBook(
      JSON.stringify({
        costs: {
          good: { kind: "free" },
          noPrice: { kind: "paid", cycle: "monthly", renewsOn: null },
          zero: {
            kind: "paid",
            price: { minor: 0, currency: "USD" },
            cycle: "monthly",
            renewsOn: null,
          },
          odd: { kind: "gift" },
        },
        topUps: [
          { id: "x", connectionId: "good", date: "2026-10-01", kind: "free" },
          { id: "y", connectionId: "good", date: "soon", kind: "free" },
          { id: "z", connectionId: "good", date: "2026-10-01", kind: "paid" },
        ],
        displayCurrency: "JPY",
        perUsd: { EUR: -3, INR: 83.5, JPY: 150 },
      }),
    );
    expect(Object.keys(loose.costs)).toEqual(["good"]);
    expect(loose.topUps.map((topUp) => topUp.id)).toEqual(["x"]);
    expect(loose.displayCurrency).toBe("USD");
    expect(loose.perUsd).toEqual({ USD: 1, INR: 83.5 });
  });
});

describe("saved book", () => {
  test("round-trips through storage", () => {
    const storage = memory();
    saveBook(storage, book);
    expect(storage.data.has(walletKey)).toBe(true);
    expect(readBook(storage)).toEqual(book);
  });
  test("a broken saved value reads as the empty book", () => {
    expect(readBook(memory({ [walletKey]: "oops" }))).toBe(emptyBook);
  });
});

describe("wallet store", () => {
  test("starts from storage and saves each change", () => {
    const storage = memory({ [walletKey]: JSON.stringify(book) });
    const store = createWalletStore(storage);
    expect(store.real()).toEqual(book);
    const seen: number[] = [];
    const stop = store.subscribe(() => seen.push(Object.keys(store.real().costs).length));
    store.setReal({ ...book, costs: {} });
    stop();
    store.setReal(book);
    expect(seen).toEqual([0]);
    expect(readBook(storage)).toEqual(book);
  });
  test("Demo Mode edits stay in memory and never write the saved key", () => {
    const storage = memory({ [walletKey]: JSON.stringify(book) });
    const before = storage.data.get(walletKey);
    const store = createWalletStore(storage);
    let made = 0;
    const make = (): WalletBook => {
      made += 1;
      return emptyBook;
    };
    expect(store.demo("1:100", make)).toBe(emptyBook);
    expect(store.demo("1:100", make)).toBe(emptyBook);
    expect(made).toBe(1);
    store.setDemo("1:100", { ...emptyBook, displayCurrency: "GBP" });
    expect(store.demo("1:100", make).displayCurrency).toBe("GBP");
    expect(storage.data.get(walletKey)).toBe(before);
    expect(store.real()).toEqual(book);
    // A new key starts a new demo book.
    expect(store.demo("2:200", make)).toBe(emptyBook);
    expect(made).toBe(2);
  });
  test("works with no storage, and a failing write keeps the book in memory", () => {
    const store = createWalletStore(null);
    store.setReal(book);
    expect(store.real()).toBe(book);
    const full = createWalletStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    full.setReal(book);
    expect(full.real()).toBe(book);
  });
});
