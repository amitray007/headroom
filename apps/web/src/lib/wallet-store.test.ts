import { describe, expect, test } from "bun:test";

import { emptyBook, type WalletBook } from "@headroom/view-model/wallet";

import { ApiError, type ServerWallet } from "../api.ts";
import {
  createWalletStore,
  importLegacyBook,
  parseBook,
  walletKey,
  type WalletClient,
} from "./wallet-store.ts";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
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
};

const server = (extra: Partial<ServerWallet> = {}): ServerWallet => ({
  costs: {},
  topUps: [],
  ...extra,
});

function fakeClient(options: { reject?: (what: string) => Error | null } = {}) {
  const calls: string[] = [];
  const gates: (() => void)[] = [];
  let current = server();
  const run = async (what: string, next: (book: ServerWallet) => ServerWallet) => {
    calls.push(what);
    const error = options.reject?.(what) ?? null;
    if (error !== null) throw error;
    current = next(current);
    return current;
  };
  const client: WalletClient = {
    wallet: () => Promise.resolve(current),
    setCost: (id, cost) => run(`set ${id}`, (b) => ({ ...b, costs: { ...b.costs, [id]: cost } })),
    clearCost: (id) =>
      run(`clear ${id}`, (b) => ({
        ...b,
        costs: Object.fromEntries(Object.entries(b.costs).filter(([key]) => key !== id)),
      })),
    addTopUp: (input) =>
      run(`add ${input.connectionId}`, (b) => ({
        ...b,
        topUps: [{ id: `s${b.topUps.length + 1}`, ...input }, ...b.topUps],
      })),
    removeTopUp: (id) =>
      run(`remove ${id}`, (b) => ({ ...b, topUps: b.topUps.filter((t) => t.id !== id) })),
  };
  return { client, calls, gates };
}

const unknownConnection = new ApiError(404, "Request failed (404)", "unknown_connection");

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
        displayCurrency: "XYZ",
      }),
    );
    expect(Object.keys(loose.costs)).toEqual(["good"]);
    expect(loose.topUps.map((topUp) => topUp.id)).toEqual(["x"]);
    expect(loose.displayCurrency).toBeNull();
  });
  test("a book saved before the owner chose a currency has none", () => {
    const old = parseBook(JSON.stringify({ costs: {}, topUps: [] }));
    expect(old.displayCurrency).toBeNull();
  });
  test("rates saved by an older version are ignored", () => {
    const older = parseBook(
      JSON.stringify({
        displayCurrency: "JPY",
        perUsd: { CAD: 1.4, BRL: 5.4 },
        ratesChangedOn: "2026-10-03",
      }),
    );
    expect(older).toEqual({ costs: {}, topUps: [], displayCurrency: "JPY" });
  });
});

describe("wallet store", () => {
  test("loads the server book; a failed load is flagged", async () => {
    const { client } = fakeClient();
    const store = createWalletStore(client);
    expect(store.getState().loaded).toBe(false);
    await store.load();
    expect(store.getState()).toMatchObject({ loaded: true, loadFailed: false });
    const down = createWalletStore({ ...client, wallet: () => Promise.reject(new Error("down")) });
    await down.load();
    expect(down.getState()).toMatchObject({ loaded: true, loadFailed: true });
  });
  test("mutations take the returned book; null clears a cost", async () => {
    const { client, calls } = fakeClient();
    const store = createWalletStore(client);
    await store.setCost("a", { kind: "free" });
    expect(store.getState().costs).toEqual({ a: { kind: "free" } });
    await store.addTopUp({
      connectionId: "a",
      date: "2026-10-01",
      kind: "free",
      price: null,
      credits: null,
      note: null,
    });
    expect(store.getState().topUps.map((t) => t.id)).toEqual(["s1"]);
    await store.removeTopUp("s1");
    await store.setCost("a", null);
    expect(store.getState()).toMatchObject({ costs: {}, topUps: [] });
    expect(calls).toEqual(["set a", "add a", "remove s1", "clear a"]);
  });
  test("a refused mutation rejects and leaves the state alone", async () => {
    const { client } = fakeClient({
      reject: (what) => (what === "set b" ? new Error("no") : null),
    });
    const store = createWalletStore(client);
    await store.setCost("a", { kind: "free" });
    const before = store.getState();
    expect(await store.setCost("b", { kind: "free" }).catch(() => "rejected")).toBe("rejected");
    expect(store.getState()).toBe(before);
    await store.setCost("c", { kind: "free" });
    expect(Object.keys(store.getState().costs)).toEqual(["a", "c"]);
  });
  test("mutations run one after another", async () => {
    const order: string[] = [];
    const release: (() => void)[] = [];
    const slow = (name: string) =>
      new Promise<ServerWallet>((done) => {
        order.push(`start ${name}`);
        release.push(() => {
          order.push(`end ${name}`);
          done(server());
        });
      });
    const { client } = fakeClient();
    const store = createWalletStore({
      ...client,
      setCost: (id) => slow(id),
      removeTopUp: (id) => slow(id),
    });
    const first = store.setCost("a", { kind: "free" });
    const second = store.removeTopUp("t");
    await Bun.sleep(0);
    expect(order).toEqual(["start a"]);
    release[0]?.();
    await first;
    await Bun.sleep(0);
    release[1]?.();
    await second;
    expect(order).toEqual(["start a", "end a", "start t", "end t"]);
  });
  test("Demo Mode edits stay in memory", () => {
    const store = createWalletStore(fakeClient().client);
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
    expect(store.demo("2:200", make)).toBe(emptyBook);
    expect(made).toBe(2);
  });
});

describe("legacy import", () => {
  const noCurrency = { current: null, save: () => Promise.resolve() };
  test("does nothing without a saved book", async () => {
    const { client, calls } = fakeClient();
    expect(await importLegacyBook(client, memory(), noCurrency)).toBeNull();
    expect(calls).toEqual([]);
  });
  test("sends costs and top-ups, saves the currency, then removes the key", async () => {
    const storage = memory({ [walletKey]: JSON.stringify(book) });
    const { client, calls } = fakeClient();
    const saved: string[] = [];
    const latest = await importLegacyBook(client, storage, {
      current: null,
      save: (currency) => {
        saved.push(currency);
        return Promise.resolve();
      },
    });
    expect(calls).toEqual(["set a", "set b", "set c", "add a", "add b"]);
    expect(latest?.topUps.map((t) => t.id)).toEqual(["s2", "s1"]);
    expect(saved).toEqual(["EUR"]);
    expect(storage.data.has(walletKey)).toBe(false);
  });
  test("keeps a currency the server already has", async () => {
    const storage = memory({ [walletKey]: JSON.stringify(book) });
    const saved: string[] = [];
    await importLegacyBook(fakeClient().client, storage, {
      current: "GBP",
      save: (currency) => {
        saved.push(currency);
        return Promise.resolve();
      },
    });
    expect(saved).toEqual([]);
  });
  test("skips unknown connections and still removes the key", async () => {
    const storage = memory({ [walletKey]: JSON.stringify(book) });
    const { client } = fakeClient({
      reject: (what) => (what === "set b" ? unknownConnection : null),
    });
    await importLegacyBook(client, storage, noCurrency);
    expect(storage.data.has(walletKey)).toBe(false);
  });
  test("keeps the key when any request fails for another reason", async () => {
    const storage = memory({ [walletKey]: JSON.stringify(book) });
    const { client } = fakeClient({
      reject: (what) => (what === "add a" ? new Error("down") : null),
    });
    await importLegacyBook(client, storage, noCurrency);
    expect(storage.data.has(walletKey)).toBe(true);
    // The next load sends only what did not go through: no top-up reaches the server twice.
    const retry = fakeClient();
    await importLegacyBook(retry.client, storage, noCurrency);
    expect(retry.calls).toEqual(["add a"]);
    expect(storage.data.has(walletKey)).toBe(false);
    const failing = memory({ [walletKey]: JSON.stringify(book) });
    await importLegacyBook(fakeClient().client, failing, {
      current: null,
      save: () => Promise.reject(new Error("down")),
    });
    expect(failing.data.has(walletKey)).toBe(true);
  });
});
