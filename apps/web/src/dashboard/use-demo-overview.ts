import { demoOverview, type DemoOverview } from "@headroom/view-model/demo";
import { useCallback, useMemo, useState } from "react";

import { applyOrder, type DisplayOrder } from "../lib/reorder.ts";
import type { useOverview } from "./use-overview.ts";

const reloaded = (): Promise<void> => Promise.resolve();

/**
 * The made-up overview for Demo Mode, in the shape of `useOverview()`; null while Demo Mode is off. The same
 * seed and anchor give the same accounts. Reordering is kept here, so dragging works and the server never hears of it.
 */
export function useDemoOverview(
  enabled: boolean,
  seed: number,
  anchor: number,
): ReturnType<typeof useOverview> | null {
  const base = useMemo<DemoOverview | null>(
    () => (enabled ? demoOverview(seed, anchor) : null),
    [enabled, seed, anchor],
  );
  const [chosen, setChosen] = useState<{
    readonly base: DemoOverview;
    readonly order: DisplayOrder;
  } | null>(null);
  const reorder = useCallback(
    (order: DisplayOrder): void => {
      if (base !== null) setChosen({ base, order });
    },
    [base],
  );
  return useMemo(() => {
    if (base === null) return null;
    // An order chosen under an earlier seed does not carry over.
    const order = chosen !== null && chosen.base === base ? chosen.order : null;
    return {
      connections: order === null ? base.connections : applyOrder(base.connections, order),
      providerOrder: order === null ? base.providerOrder : order.providers,
      failed: false,
      stale: false,
      reload: reloaded,
      applyOrder: reorder,
    };
  }, [base, chosen, reorder]);
}
