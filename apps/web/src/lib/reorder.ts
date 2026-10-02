import type { Provider } from "@headroom/core/contracts";

import type { OverviewConnection } from "../api.ts";

/** The owner's display order: every provider, and the account ids of each provider that has accounts. */
export interface DisplayOrder {
  readonly providers: readonly Provider[];
  readonly accounts: Readonly<Record<string, readonly string[]>>;
}

/** Move one entry of a list to a new index. Out-of-range indexes clamp; a no-op returns the same list. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (from < 0 || from >= list.length || from === target) return [...list];
  const next = [...list];
  next.splice(target, 0, ...next.splice(from, 1));
  return next;
}

/**
 * Move a provider to a new place among the providers that show (those with accounts). Providers that do not
 * show keep their own slots, so the full order stays complete.
 */
export function moveProvider(
  order: DisplayOrder,
  visible: readonly Provider[],
  provider: Provider,
  to: number,
): DisplayOrder {
  const from = visible.indexOf(provider);
  if (from < 0) return order;
  const moved = moveItem(visible, from, to);
  const shown = new Set(visible);
  let next = 0;
  const providers = order.providers.map((entry) =>
    shown.has(entry) ? (moved[next++] ?? entry) : entry,
  );
  return { providers, accounts: order.accounts };
}

/** Move an account within its own provider. An id that is not in that provider changes nothing. */
export function moveAccount(
  order: DisplayOrder,
  provider: Provider,
  id: string,
  to: number,
): DisplayOrder {
  const list = order.accounts[provider] ?? [];
  const from = list.indexOf(id);
  if (from < 0) return order;
  return {
    providers: order.providers,
    accounts: { ...order.accounts, [provider]: moveItem(list, from, to) },
  };
}

/** The body for PUT /api/order: the full current order. */
export function orderBody(order: DisplayOrder): {
  providers: Provider[];
  accounts: Record<string, string[]>;
} {
  return {
    providers: [...order.providers],
    accounts: Object.fromEntries(
      Object.entries(order.accounts).map(([provider, ids]) => [provider, [...ids]]),
    ),
  };
}

/**
 * The order the list shows now: the given provider order (providers it misses follow in the order they
 * appear), and accounts in list order within their provider.
 */
export function orderOf(
  connections: readonly OverviewConnection[],
  providerOrder: readonly Provider[],
): DisplayOrder {
  const accounts: Record<string, string[]> = {};
  for (const connection of connections) (accounts[connection.provider] ??= []).push(connection.id);
  const providers = [...providerOrder];
  for (const connection of connections) {
    if (!providers.includes(connection.provider)) providers.push(connection.provider);
  }
  return { providers, accounts };
}

/** Sort connections into an order: providers by rank, accounts by their place. Unlisted accounts go last. */
export function applyOrder(
  connections: readonly OverviewConnection[],
  order: DisplayOrder,
): OverviewConnection[] {
  const rank = new Map(order.providers.map((provider, index) => [provider, index]));
  const place = (connection: OverviewConnection): number => {
    const at = order.accounts[connection.provider]?.indexOf(connection.id) ?? -1;
    return at < 0 ? Number.POSITIVE_INFINITY : at;
  };
  return connections.toSorted(
    (a, b) =>
      (rank.get(a.provider) ?? Number.POSITIVE_INFINITY) -
        (rank.get(b.provider) ?? Number.POSITIVE_INFINITY) ||
      place(a) - place(b) ||
      a.createdAt - b.createdAt,
  );
}

/** Where a dragged item sits, measured before the drag: top edge and height in one shared axis. */
export interface Slot {
  readonly top: number;
  readonly height: number;
}

/**
 * The index the dragged item takes when it is `shift` away from its slot. It passes a neighbour once its
 * leading edge crosses that neighbour's centre, so the clamped ends of the list always reach the end slots.
 */
export function targetIndex(slots: readonly Slot[], dragged: number, shift: number): number {
  const item = slots[dragged];
  if (item === undefined) return dragged;
  const top = item.top + shift;
  const bottom = top + item.height;
  let to = dragged;
  slots.forEach((slot, index) => {
    const centre = slot.top + slot.height / 2;
    if (index > dragged && bottom > centre) to += 1;
    if (index < dragged && top < centre) to -= 1;
  });
  return to;
}

/**
 * How far each item moves (in the axis) when the dragged one takes index `to`. Items keep their heights and
 * stack from the first item's top, so the dragged item's gap opens exactly where it will land.
 */
export function offsetsFor(slots: readonly Slot[], dragged: number, to: number): number[] {
  const first = slots[0];
  if (first === undefined) return [];
  const order = moveItem(
    slots.map((_, index) => index),
    dragged,
    to,
  );
  const offsets: number[] = Array.from({ length: slots.length }, () => 0);
  let top = first.top;
  for (const index of order) {
    const slot = slots[index];
    if (slot === undefined) continue;
    offsets[index] = top - slot.top;
    top += slot.height;
  }
  return offsets;
}

/** Keep a drag inside its list: the dragged item cannot pass the first top or the last bottom. */
export function clampShift(slots: readonly Slot[], dragged: number, shift: number): number {
  const first = slots[0];
  const last = slots.at(-1);
  const item = slots[dragged];
  if (first === undefined || last === undefined || item === undefined) return 0;
  return Math.max(
    first.top - item.top,
    Math.min(last.top + last.height - (item.top + item.height), shift),
  );
}
