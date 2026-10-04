import { useState, useSyncExternalStore } from "react";

import { createOverviewStore, type OverviewState, type OverviewStore } from "./overview-store.ts";

interface OverviewView extends OverviewState {
  reload: OverviewStore["reload"];
  applyOrder: OverviewStore["applyOrder"];
}

/** The overview, polled every minute and reloaded after every action. */
export function useOverview(): OverviewView {
  const [store] = useState(() => createOverviewStore());
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { ...state, reload: store.reload, applyOrder: store.applyOrder };
}
