import { useCallback, useEffect, useMemo, useState } from "react";

import type { History } from "@headroom/view-model/history";

import { api } from "../../api.ts";

/** History moves slowly: ask again no more often than this. */
const pollEveryMs = 5 * 60_000;

export type HistoryState =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly history: History };

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
  const [real, setReal] = useState<{ history: History | null; failed: boolean }>({
    history: null,
    failed: false,
  });
  const live = demoHistory === null;
  const load = useCallback(async (): Promise<void> => {
    try {
      const history = await api.history(90);
      setReal({ history, failed: false });
    } catch {
      setReal((previous) => ({ ...previous, failed: true }));
    }
  }, []);
  useEffect(() => {
    if (!live) return;
    void load();
    const timer = setInterval(() => void load(), pollEveryMs);
    return () => clearInterval(timer);
    // A different set of connections is a different history.
  }, [live, idsKey, load]);
  const state: HistoryState =
    demoHistory !== null
      ? { kind: "ready", history: demoHistory }
      : real.history !== null
        ? { kind: "ready", history: real.history }
        : real.failed
          ? { kind: "failed" }
          : { kind: "loading" };
  return { state, reload: load };
}
