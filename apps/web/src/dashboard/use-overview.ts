import { useState, useSyncExternalStore } from "react";

import { createOverviewStore, type OverviewState } from "./overview-store.ts";

interface OverviewView extends OverviewState {
  reload: () => Promise<void>;
}

/** The overview, polled every minute and reloaded after every action. */
export function useOverview(): OverviewView {
  const [store] = useState(() => createOverviewStore());
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { ...state, reload: store.reload };
}
