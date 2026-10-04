import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { emptyBook, type Cost, type WalletBook } from "@headroom/view-model/wallet";
import type { Currency } from "@headroom/view-model/wallet-money";

import { api, type ServerWallet, type TopUpInput } from "../api.ts";
import { withCost, withDisplay, withoutTopUp, withTopUp, newId } from "../views/wallet/book.ts";
import { useSettings } from "./settings.tsx";

/**
 * The owner's Wallet entries are saved on the server, so every browser sees the same ones. Demo Mode has its own
 * in-memory book and never calls the server.
 */
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

let shared: WalletStore | null = null;

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
  const savedCurrency = settings.settings.walletCurrency;

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
