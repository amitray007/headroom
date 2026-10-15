import { useSyncExternalStore } from "react";

import type { History } from "@headroom/view-model/history";

import { api } from "../api.ts";

/**
 * The stored usage history for Analytics, outside React, so it outlives the page: coming back to Analytics shows
 * the last history at once and reads it again in the background. One request for the longest range.
 */
export interface HistoryStoreState {
  /** The last history that loaded; null before the first one. */
  readonly history: History | null;
  /** When `history` was fetched; 0 before the first one. */
  readonly fetchedAt: number;
  /** The latest request failed. A history already shown stays. */
  readonly failed: boolean;
}

/** History moves slowly: read it again no more often than this. */
const staleAfterMs = 5 * 60_000;

interface HistoryClient {
  history: (days: 90) => Promise<History>;
}

/** The slice of `document` the store watches: tests pass a fake, a server render passes none. */
interface Visibility {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Runs `run` every `ms` until the returned stop is called. */
type Every = (run: () => void, ms: number) => () => void;

export interface HistoryStore {
  getState: () => HistoryStoreState;
  /**
   * Read the history unless the one held is fresh and covers `idsKey` (sorted connection ids, comma-joined). Null
   * skips the ids check, for a read that starts before the overview is known. While a read is in flight, its
   * result is checked against `idsKey` when it lands, and read again once if it does not cover it.
   */
  ensure: (idsKey: string | null) => void;
  /** Read it again now, even while an older read is in flight, whose result is then dropped. Never rejects. */
  reload: () => Promise<void>;
  /** Forget the history, for a session that ends. A read in flight is dropped; a page still listening reads again. */
  clear: () => void;
  /** While anyone listens, a visible page reads it again every five minutes. */
  subscribe: (listener: () => void) => () => void;
}

/** The sorted, comma-joined connection ids a history covers. */
export function idsOf(history: History): string {
  return history.connections
    .map((connection) => connection.id)
    .toSorted()
    .join(",");
}

export function createHistoryStore(
  client: HistoryClient = api,
  options: {
    readonly now?: () => number;
    readonly visibility?: Visibility | null;
    readonly every?: Every;
  } = {},
): HistoryStore {
  const now = options.now ?? Date.now;
  const visibility =
    options.visibility === undefined
      ? typeof document === "undefined"
        ? null
        : document
      : options.visibility;
  const every: Every =
    options.every ??
    ((run, ms) => {
      const id = setInterval(run, ms);
      return () => clearInterval(id);
    });
  const listeners = new Set<() => void>();
  let state: HistoryStoreState = { history: null, fetchedAt: 0, failed: false };
  let reading: Promise<void> | null = null;
  /** Bumped by each new read and by clear(); a response from an older generation is dropped. */
  let generation = 0;
  /** The ids an ensure() asked for while a read was in flight. */
  let wanted: string | null = null;
  let lastTry = 0;
  let stopPolling: (() => void) | null = null;

  const set = (next: Partial<HistoryStoreState>): void => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  /** One request; its result lands only if no newer read or clear() came after it. */
  const load = async (mine: number): Promise<void> => {
    let history: History;
    try {
      history = await client.history(90);
    } catch {
      if (mine !== generation) return;
      reading = null;
      wanted = null;
      set({ failed: true });
      return;
    }
    if (mine !== generation) return;
    reading = null;
    set({ history, fetchedAt: now(), failed: false });
    const want = wanted;
    wanted = null;
    if (want !== null && idsOf(history) !== want) void read();
  };

  const read = (): Promise<void> => {
    generation += 1;
    lastTry = now();
    reading = load(generation);
    return reading;
  };

  const visible = (): boolean => visibility === null || visibility.visibilityState === "visible";

  // A hidden tab does not read; showing it again reads when the last try is older than the poll interval.
  const onVisible = (): void => {
    if (visible() && reading === null && now() - lastTry > staleAfterMs) void read();
  };

  return {
    getState: () => state,
    ensure(idsKey) {
      if (reading !== null) {
        if (idsKey !== null) wanted = idsKey;
        return;
      }
      const held = state.history;
      const covers = held !== null && (idsKey === null || idsOf(held) === idsKey);
      if (!covers || now() - lastTry > staleAfterMs) void read();
    },
    reload: read,
    clear() {
      generation += 1;
      reading = null;
      wanted = null;
      lastTry = 0;
      set({ history: null, fetchedAt: 0, failed: false });
      // A page that shows the history reads it again for the new session.
      if (listeners.size > 0) void read();
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        visibility?.addEventListener("visibilitychange", onVisible);
        stopPolling = every(() => {
          if (visible() && reading === null) void read();
        }, staleAfterMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        visibility?.removeEventListener("visibilitychange", onVisible);
        stopPolling?.();
        stopPolling = null;
      };
    },
  };
}

const store = createHistoryStore();

/** Start reading the history before the Analytics page has loaded. */
export const prefetchHistory = (): void => store.ensure(null);

export const historyStore = store;

const idle = (): (() => void) => () => undefined;

/** The history store's state. Only an `active` caller subscribes, so Demo Mode never starts the reads. */
export function useHistoryStore(active: boolean): HistoryStoreState {
  return useSyncExternalStore(active ? store.subscribe : idle, store.getState, store.getState);
}
