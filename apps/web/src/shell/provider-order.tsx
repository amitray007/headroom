import { useRef } from "react";

import { api } from "../api.ts";
import { BrandMark } from "../icons.tsx";
import { groupByProvider, providerName } from "../lib/labels.ts";
import { moveProvider, orderBody, orderOf } from "../lib/reorder.ts";
import { SortableList } from "../ui/sortable-list.tsx";
import type { ViewProps } from "../views/props.ts";

/** Providers that have accounts, in the owner's order. Moving one shows at once and saves; a failed save puts it back. */
export function ProviderOrderList(props: {
  readonly overview: ViewProps["overview"];
  readonly onError: (message: string | null) => void;
}) {
  const { connections, providerOrder, applyOrder } = props.overview;
  const newest = useRef(0);
  const shown = groupByProvider(connections ?? [], providerOrder).map((group) => group.provider);

  const move = (id: string, to: number): void => {
    const provider = shown.find((entry) => entry === id);
    if (provider === undefined || connections === null) return;
    const base = orderOf(connections, providerOrder);
    const next = moveProvider(base, shown, provider, to);
    const seq = (newest.current += 1);
    props.onError(null);
    applyOrder(next);
    api.saveOrder(orderBody(next)).catch(() => {
      // A later move sends the full order again, so only the newest save rolls back.
      if (seq !== newest.current) return;
      applyOrder(base);
      props.onError("Could not save the provider order. Nothing was changed.");
    });
  };

  return (
    <SortableList
      label="Provider Order"
      items={shown.map((provider) => ({
        id: provider,
        label: providerName(provider),
        icon: <BrandMark provider={provider} />,
      }))}
      onMove={move}
    />
  );
}
