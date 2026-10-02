import { api, type OverviewConnection } from "../api.ts";

const pollMs = 60_000;

export interface OverviewState {
  /** Null until the first load works. A later failed poll keeps the last good list. */
  readonly connections: readonly OverviewConnection[] | null;
  /** The first load failed and there is nothing to show. */
  readonly failed: boolean;
  /** A later load failed. The list is the last good one. */
  readonly stale: boolean;
}

interface OverviewClient {
  overview: () => Promise<{ connections: OverviewConnection[] }>;
}

export interface OverviewStore {
  getState: () => OverviewState;
  subscribe: (listener: () => void) => () => void;
  /** Load again now. Resolves when the new list is in, or the load failed. */
  reload: () => Promise<void>;
}

/** The overview outside React: loaded on first subscriber, polled every minute, reloaded after actions. */
export function createOverviewStore(client: OverviewClient = api): OverviewStore {
  let state: OverviewState = { connections: null, failed: false, stale: false };
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
        JSON.stringify(state.connections) === JSON.stringify(next.connections);
      if (same && !state.stale) return;
      set({
        connections: same ? state.connections : next.connections,
        failed: false,
        stale: false,
      });
    } catch {
      const loaded = state.connections !== null;
      set({ connections: state.connections, failed: !loaded, stale: loaded });
    }
  };
  return {
    getState: () => state,
    reload,
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
