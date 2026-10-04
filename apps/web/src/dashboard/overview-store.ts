import type { Provider } from "@headroom/core/contracts";

import { api, type OverviewConnection } from "../api.ts";
import { applyOrder, type DisplayOrder } from "../lib/reorder.ts";

const pollMs = 60_000;

export interface OverviewState {
  /** Null until the first load works. A later failed poll keeps the last good list. */
  readonly connections: readonly OverviewConnection[] | null;
  /** The owner's provider order. Empty until the first load, which means the default order. */
  readonly providerOrder: readonly Provider[];
  /** The first load failed and there is nothing to show. */
  readonly failed: boolean;
  /** A later load failed. The list is the last good one. */
  readonly stale: boolean;
}

interface OverviewClient {
  overview: () => Promise<{ connections: OverviewConnection[]; providerOrder: Provider[] }>;
}

export interface OverviewStore {
  getState: () => OverviewState;
  subscribe: (listener: () => void) => () => void;
  /** Load again now. Resolves when the new list is in, or the load failed. */
  reload: () => Promise<void>;
  /** Show a new order at once, before the server confirms it. The next load brings the server's own. */
  applyOrder: (order: DisplayOrder) => void;
}

/** The overview outside React: loaded on first subscriber, polled every minute, reloaded after actions. */
export function createOverviewStore(client: OverviewClient = api): OverviewStore {
  let state: OverviewState = {
    connections: null,
    providerOrder: [],
    failed: false,
    stale: false,
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: OverviewState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  const reload = async (): Promise<void> => {
    try {
      const next = await client.overview();
      // A poll that finds nothing new changes nothing, so the page does not re-render for it.
      const same =
        state.connections !== null &&
        JSON.stringify([state.connections, state.providerOrder]) ===
          JSON.stringify([next.connections, next.providerOrder]);
      if (same && !state.stale) return;
      set({
        connections: same ? state.connections : next.connections,
        providerOrder: same ? state.providerOrder : next.providerOrder,
        failed: false,
        stale: false,
      });
    } catch {
      const loaded = state.connections !== null;
      set({ ...state, failed: !loaded, stale: loaded });
    }
  };
  return {
    getState: () => state,
    reload,
    applyOrder(order) {
      if (state.connections === null) return;
      set({
        ...state,
        connections: applyOrder(state.connections, order),
        providerOrder: order.providers,
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      if (timer === null) {
        void reload();
        timer = setInterval(() => void reload(), pollMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
}
