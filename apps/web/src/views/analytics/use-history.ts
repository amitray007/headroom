import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { History } from "@headroom/view-model/history";

import { api } from "../../api.ts";

/** History moves slowly: ask again no more often than this. */
const pollEveryMs = 5 * 60_000;

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
 * The stored usage history for Analytics. Real: one request for the longest range, repeated every five minutes
 * and again when the set of connections (`idsKey`) changes; a later failure keeps the last good history. Demo
 * Mode builds its own, with no request.
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
  const [real, setReal] = useState<{
    history: History | null;
    fetchedAt: number;
    failed: boolean;
  }>({ history: null, fetchedAt: 0, failed: false });
  const live = demoHistory === null;
  // Only the newest request may write: an older response that lands late is dropped.
  const sequence = useRef(0);
  const lastTry = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    sequence.current += 1;
    const mine = sequence.current;
    lastTry.current = Date.now();
    try {
      const history = await api.history(90);
      if (mine === sequence.current) setReal({ history, fetchedAt: Date.now(), failed: false });
    } catch {
      if (mine === sequence.current) setReal((previous) => ({ ...previous, failed: true }));
    }
  }, []);
  useEffect(() => {
    if (!live) return;
    void load();
    // A hidden tab does not poll; showing it again refetches when the last try is older than the poll interval.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, pollEveryMs);
    const onVisible = (): void => {
      if (document.visibilityState === "visible" && Date.now() - lastTry.current > pollEveryMs) {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // A different set of connections is a different history.
  }, [live, idsKey, load]);
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
  return { state, reload: load };
}
