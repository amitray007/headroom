import type { Provider } from "@headroom/core/contracts";

import type { OverviewConnection, Settings } from "../../api.ts";
import { isInactive, urgencyRank } from "@headroom/view-model/accounts";
import { groupByProvider } from "@headroom/view-model/labels";
import type { ProviderFilter } from "../../ui/provider-chips.tsx";

export type DetailedOrder = Settings["detailedOrder"];

/** A run of accounts shown together: a plain list, one provider, or the inactive accounts. */
export interface Section {
  readonly key: string;
  readonly kind: "list" | "provider" | "inactive";
  readonly provider: Provider | null;
  readonly connections: readonly OverviewConnection[];
}

export interface ArrangeOptions {
  readonly order: DetailedOrder;
  readonly providerOrder: readonly Provider[];
  readonly keepInactiveLast: boolean;
  readonly lowThreshold: number;
}

/** One flat list. Urgency sorts by room left and keeps the saved order for ties; the others follow the saved order. */
function flat(
  connections: readonly OverviewConnection[],
  { order, providerOrder, lowThreshold }: ArrangeOptions,
): OverviewConnection[] {
  if (order === "urgency") {
    return connections
      .map((connection, index) => ({
        connection,
        index,
        rank: urgencyRank(connection, lowThreshold),
      }))
      .toSorted((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.connection);
  }
  if (order === "provider") {
    return groupByProvider(connections, providerOrder).flatMap((group) => group.connections);
  }
  return [...connections];
}

/**
 * The accounts in the order the owner chose, as sections. `connections` arrive in the saved order. Inactive
 * accounts (paused or disconnected) form a last section when `keepInactiveLast` is on. Every account lands in
 * exactly one section, so a filter can hide accounts without rebuilding anything.
 */
export function arrange(
  connections: readonly OverviewConnection[],
  options: ArrangeOptions,
): Section[] {
  const split = options.keepInactiveLast;
  const live = split ? connections.filter((connection) => !isInactive(connection)) : connections;
  const dormant = split ? connections.filter(isInactive) : [];
  const sections: Section[] =
    options.order === "provider"
      ? groupByProvider(live, options.providerOrder).map((group) => ({
          key: group.provider,
          kind: "provider",
          provider: group.provider,
          connections: group.connections,
        }))
      : [{ key: "list", kind: "list", provider: null, connections: flat(live, options) }];
  if (dormant.length > 0) {
    sections.push({
      key: "inactive",
      kind: "inactive",
      provider: null,
      connections: flat(dormant, options),
    });
  }
  return sections.filter((section) => section.connections.length > 0);
}

/** Whether a filter lets an account show. */
export function matches(connection: OverviewConnection, filter: ProviderFilter): boolean {
  return filter === "all" || connection.provider === filter;
}

/** Providers with their account counts, in the saved provider order. */
export function providerCounts(
  connections: readonly OverviewConnection[],
  providerOrder: readonly Provider[],
): { provider: Provider; count: number }[] {
  return groupByProvider(connections, providerOrder).map((group) => ({
    provider: group.provider,
    count: group.connections.length,
  }));
}
