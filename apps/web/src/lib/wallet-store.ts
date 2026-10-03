import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { emptyBook, type Cost, type TopUp, type WalletBook } from "@headroom/view-model/wallet";
import { currencies, type Currency, type Money } from "@headroom/view-model/wallet-money";

import { api, ApiError, type ServerWallet, type TopUpInput } from "../api.ts";
import { withCost, withDisplay, withoutTopUp, withTopUp, newId } from "../views/wallet/book.ts";
import { browserStorage } from "./device-prefs.ts";
import { useSettings } from "./settings.tsx";

/**
 * The owner's Wallet entries are saved on the server, so every browser sees the same ones. Demo Mode has its own
 * in-memory book and never calls the server.
 *
 * Builds that predated the server kept the book in this browser under this localStorage key. It is read once,
 * after the first server load, and sent to the server.
 */
export const walletKey = "headroom.wallet";

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

/**
 * Read the old browser-saved JSON loosely: entries that do not fit are dropped, and a value that is not a book is an empty one.
 * Rates saved by an older version (`perUsd`, `ratesChangedOn`) are ignored: the server supplies them now.
 */
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
  return {
    costs,
    topUps,
    displayCurrency: readCurrency(parsed["displayCurrency"]),
  };
}

export interface WalletClient {
  wallet: () => Promise<ServerWallet>;
  setCost: (connectionId: string, cost: Cost) => Promise<ServerWallet>;
  clearCost: (connectionId: string) => Promise<ServerWallet>;
  addTopUp: (input: TopUpInput) => Promise<ServerWallet>;
  removeTopUp: (id: string) => Promise<ServerWallet>;
}

interface WalletState {
  readonly costs: ServerWallet["costs"];
  readonly topUps: ServerWallet["topUps"];
  /** True once the first load finished, whether or not it worked. */
  readonly loaded: boolean;
  /** The last load failed, so the Wallet shown is empty and not the owner's. */
  readonly loadFailed: boolean;
}

export interface WalletStore {
  getState: () => WalletState;
  subscribe: (listener: () => void) => () => void;
  load: () => Promise<void>;
  /** Replace the state with a book the server returned, outside a mutation. */
  adopt: (book: ServerWallet) => void;
  /** Set a cost, or clear it with null. Rejects, with the state unchanged, when the server refuses. */
  setCost: (connectionId: string, cost: Cost | null) => Promise<void>;
  addTopUp: (input: TopUpInput) => Promise<void>;
  removeTopUp: (id: string) => Promise<void>;
  /** The in-memory Demo Mode book for `key`, made on first use. A new key starts a new book. */
  demo: (key: string, make: () => WalletBook) => WalletBook;
  /** Replace the Demo Mode book. Nothing is sent. */
  setDemo: (key: string, book: WalletBook) => void;
}

/**
 * The Wallet outside React. Each mutation waits for the server and then takes the book it returns; a refused one
 * leaves the state as it was. Mutations run one after another so the server ends on the newest accepted state.
 */
export function createWalletStore(client: WalletClient): WalletStore {
  let state: WalletState = { costs: {}, topUps: [], loaded: false, loadFailed: false };
  let demo: { readonly key: string; readonly book: WalletBook } | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const set = (next: Partial<WalletState>): void => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  const take = (book: ServerWallet): void =>
    set({ costs: book.costs, topUps: book.topUps, loaded: true, loadFailed: false });
  const mutate = (call: () => Promise<ServerWallet>): Promise<void> => {
    const run = queue.then(call).then(take);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async load() {
      try {
        take(await client.wallet());
      } catch {
        set({ loaded: true, loadFailed: true });
      }
    },
    adopt: take,
    setCost: (connectionId, cost) =>
      mutate(() =>
        cost === null ? client.clearCost(connectionId) : client.setCost(connectionId, cost),
      ),
    addTopUp: (input) => mutate(() => client.addTopUp(input)),
    removeTopUp: (id) => mutate(() => client.removeTopUp(id)),
    demo(key, make) {
      if (demo?.key !== key) demo = { key, book: make() };
      return demo.book;
    },
    setDemo(key, book) {
      demo = { key, book };
      for (const listener of listeners) listener();
    },
  };
}

interface LegacyStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const refusedAsUnknown = (cause: unknown): boolean =>
  cause instanceof ApiError && cause.status === 404 && cause.code === "unknown_connection";

/**
 * Send a book saved in this browser by the exploration build to the server. Costs are PUT and top-ups POSTed
 * without their local ids; entries for an account the server does not know are skipped. Afterwards the saved copy
 * keeps only what did not go through, so the next load retries those and never sends a top-up twice.
 * Resolves with the server's latest book, or null when there was nothing to import.
 */
export async function importLegacyBook(
  client: Pick<WalletClient, "setCost" | "addTopUp">,
  storage: LegacyStorage,
  currency: {
    /** The saved Wallet currency; the local one is used only when this is null. */
    readonly current: Currency | null;
    readonly save: (currency: Currency) => Promise<void>;
  },
): Promise<ServerWallet | null> {
  const text = storage.getItem(walletKey);
  if (text === null) return null;
  const local = parseBook(text);
  let latest: ServerWallet | null = null;
  /** True when the entry reached the server, or the server refused it for an unknown account. */
  const attempt = async (send: () => Promise<ServerWallet>): Promise<boolean> => {
    try {
      latest = await send();
      return true;
    } catch (cause) {
      return refusedAsUnknown(cause);
    }
  };
  const costs: Record<string, Cost> = {};
  for (const [connectionId, cost] of Object.entries(local.costs)) {
    // oxlint-disable-next-line no-await-in-loop -- the server takes one entry at a time, in order
    if (!(await attempt(() => client.setCost(connectionId, cost)))) costs[connectionId] = cost;
  }
  const topUps: TopUp[] = [];
  for (const topUp of local.topUps) {
    const { id: _local, ...input } = topUp;
    // oxlint-disable-next-line no-await-in-loop -- the server takes one entry at a time, in order
    if (!(await attempt(() => client.addTopUp(input)))) topUps.push(topUp);
  }
  let displayCurrency: Currency | null = null;
  if (local.displayCurrency !== null && currency.current === null) {
    try {
      await currency.save(local.displayCurrency);
    } catch {
      displayCurrency = local.displayCurrency;
    }
  }
  const left: WalletBook = { costs, topUps, displayCurrency };
  try {
    if (Object.keys(costs).length === 0 && topUps.length === 0 && displayCurrency === null) {
      storage.removeItem(walletKey);
    } else {
      storage.setItem(walletKey, JSON.stringify(left));
    }
  } catch {
    // A blocked storage keeps the old copy. Costs are safe to send again; a top-up could repeat.
  }
  return latest;
}

let shared: WalletStore | null = null;
let imported = false;

function walletStore(): WalletStore {
  shared ??= createWalletStore(api);
  return shared;
}

/** How to build the Demo Mode book. `key` changes when Demo Mode starts over. */
export interface DemoSource {
  readonly key: string;
  readonly make: () => WalletBook;
}

export interface Wallet {
  readonly book: WalletBook;
  readonly loaded: boolean;
  readonly loadFailed: boolean;
  readonly reload: () => Promise<void>;
  /** Set a cost, or clear it with null. Rejects when it could not be saved. */
  readonly setCost: (connectionId: string, cost: Cost | null) => Promise<void>;
  readonly addTopUp: (input: TopUpInput) => Promise<void>;
  readonly removeTopUp: (id: string) => Promise<void>;
  readonly setDisplayCurrency: (currency: Currency) => Promise<void>;
}

/**
 * The Wallet to show. Real: the server's book, with the display currency from the settings. With a `demo`
 * source: the in-memory demo book, edited locally with no request.
 */
export function useWallet(demo: DemoSource | null): Wallet {
  const store = walletStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const settings = useSettings();
  const key = demo?.key ?? null;
  const make = demo?.make;
  const readDemo = (): WalletBook | null =>
    key === null || make === undefined ? null : store.demo(key, make);
  const demoBook = useSyncExternalStore(store.subscribe, readDemo, readDemo);

  const real = demoBook === null;
  const { loaded } = state;
  useEffect(() => {
    if (real && !loaded) void store.load();
  }, [real, loaded, store]);

  const update = settings.update;
  const settingsReady = settings.loaded && !settings.loadFailed;
  const savedCurrency = settings.settings.walletCurrency;
  const ready = real && loaded && !state.loadFailed && settingsReady;
  useEffect(() => {
    if (!ready || imported) return;
    const storage = browserStorage();
    if (storage === null) return;
    imported = true;
    void importLegacyBook(api, storage, {
      current: savedCurrency,
      save: (currency) => update({ walletCurrency: currency }),
    }).then((latest) => (latest === null ? undefined : store.adopt(latest)));
  }, [ready, savedCurrency, update, store]);

  const book = useMemo<WalletBook>(
    () => demoBook ?? { costs: state.costs, topUps: state.topUps, displayCurrency: savedCurrency },
    [demoBook, state.costs, state.topUps, savedCurrency],
  );
  const edit = useCallback(
    (change: (book: WalletBook) => WalletBook): Promise<void> => {
      if (key !== null) store.setDemo(key, change(store.demo(key, emptyBookMaker)));
      return Promise.resolve();
    },
    [key, store],
  );
  return useMemo<Wallet>(
    () => ({
      book,
      loaded: real ? loaded : true,
      loadFailed: real && state.loadFailed,
      reload: () => (real ? store.load() : Promise.resolve()),
      setCost: (connectionId, cost) =>
        real ? store.setCost(connectionId, cost) : edit((b) => withCost(b, connectionId, cost)),
      addTopUp: (input) =>
        real ? store.addTopUp(input) : edit((b) => withTopUp(b, { ...input, id: newId() })),
      removeTopUp: (id) => (real ? store.removeTopUp(id) : edit((b) => withoutTopUp(b, id))),
      setDisplayCurrency: (currency) =>
        real ? update({ walletCurrency: currency }) : edit((b) => withDisplay(b, currency)),
    }),
    [book, real, loaded, state.loadFailed, store, edit, update],
  );
}

const emptyBookMaker = (): WalletBook => emptyBook;
