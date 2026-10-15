import { useEffect, useMemo } from "react";

import type { History } from "@headroom/view-model/history";

import { historyStore, useHistoryStore } from "../../lib/history-store.ts";

export type HistoryState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly history: History;
      /** When the shown history was fetched, if the latest refresh failed; else null. */
      readonly refreshFailedAfter: number | null;
    };

/** Demo Mode's made-up history: built once for `key`, never fetched. */
export interface DemoHistory {
  readonly key: string;
  readonly make: () => History;
}

/**
 * The stored usage history for Analytics. Real: the history store keeps the last one across visits, reads it again
 * when it is older than five minutes or does not cover the connections in `idsKey`, and keeps the last good one
 * when a later read fails. Demo Mode builds its own, with no request.
 */
export function useHistory(
  demo: DemoHistory | null,
  idsKey: string,
): { readonly state: HistoryState; readonly reload: () => Promise<void> } {
  const demoKey = demo?.key ?? null;
  const make = demo?.make;
  const demoHistory = useMemo(
    () => (demoKey === null || make === undefined ? null : make()),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the made-up history follows the seed and anchor in `demoKey`, not the identity of `make`
    [demoKey],
  );
  const live = demoHistory === null;
  const real = useHistoryStore(live);
  useEffect(() => {
    if (live) historyStore.ensure(idsKey);
  }, [live, idsKey]);
  const state: HistoryState =
    demoHistory !== null
      ? { kind: "ready", history: demoHistory, refreshFailedAfter: null }
      : real.history !== null
        ? {
            kind: "ready",
            history: real.history,
            refreshFailedAfter: real.failed ? real.fetchedAt : null,
          }
        : real.failed
          ? { kind: "failed" }
          : { kind: "loading" };
  return { state, reload: historyStore.reload };
}
