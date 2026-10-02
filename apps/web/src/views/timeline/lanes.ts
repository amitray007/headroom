import type { Provider } from "@headroom/core/contracts";

import type { OverviewConnection } from "../../api.ts";
import { isInactive, meterWindows, type MeterWindow, type WindowKind } from "../../lib/accounts.ts";
import { groupByProvider } from "../../lib/labels.ts";
import { presentPanel } from "../../lib/present.ts";
import { captionOf, toneOf, type Caption, type Tone } from "../../lib/tone.ts";

/**
 * The accounts as lanes of the Timeline: for one window kind, each account that has such a window gets its
 * current window as a span from when it opened to when it resets, plus its banked reset expiries. Also the
 * Up Next and Watch List builders. Pure; an unknown value stays null.
 */

export type TimelineKind = Exclude<WindowKind, "other">;

export const timelineKinds: readonly { readonly value: TimelineKind; readonly label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "session", label: "5-Hour" },
  { value: "cycle", label: "Cycle" },
];

const day = 86_400_000;
/** Banked resets that expire within this long are flagged "Expires Soon". */
export const expiresSoonMs = 3 * day;

export interface Bank {
  readonly at: number;
  /** Position among the account's banked resets, soonest first, from 0. */
  readonly index: number;
  readonly count: number;
  /** Singular noun, such as "Reset Credit". */
  readonly label: string;
}

type Spanned = MeterWindow & { start: number; end: number; seconds: number };

export interface Lane {
  readonly id: string;
  readonly connection: OverviewConnection;
  readonly kind: TimelineKind;
  /** Every meter of this kind, for the popover. */
  readonly meters: readonly MeterWindow[];
  /** The window the bar stands for: the one with the most used. */
  readonly drawn: MeterWindow;
  /** current: open now. idle: a session that has not started. ended: the last reading is of a window that closed. */
  readonly phase: "current" | "idle" | "ended";
  readonly used: number | null;
  readonly start: number;
  readonly end: number;
  readonly lengthMs: number;
  readonly banks: readonly Bank[];
  readonly inactive: boolean;
}

function hasSpan(window: MeterWindow): window is Spanned {
  return window.start !== null && window.end !== null && window.seconds !== null;
}

interface Banked {
  /** Null when the provider did not report how many. */
  readonly count: number | null;
  /** Singular noun: "Reset Grant" for Claude, "Reset Credit" for Codex. */
  readonly label: string;
  readonly expiries: readonly number[];
}

/** The banked resets of an account: Claude shows them as a summary, Codex as a cell. Null when it has none to report. */
function bankedOf(connection: OverviewConnection): Banked | null {
  const panel = presentPanel(connection);
  if (panel.banked !== null) return panel.banked;
  for (const cell of panel.cells) {
    if (cell.kind === "resets") {
      return { count: cell.count, label: "Reset Credit", expiries: cell.expiries };
    }
  }
  return null;
}

/** Banked reset expiries still ahead of `now`, soonest first. */
function banksOf(connection: OverviewConnection, now: number): Bank[] {
  const banked = bankedOf(connection);
  if (banked === null) return [];
  const ahead = banked.expiries.filter((at) => at > now);
  return ahead.map((at, index) => ({ at, index, count: ahead.length, label: banked.label }));
}

/** The lane an account draws for a window kind, or null when it has no window of that kind to draw. */
export function laneOf(
  connection: OverviewConnection,
  kind: TimelineKind,
  now: number,
): Lane | null {
  const meters = meterWindows(connection).filter(
    (window) => window.kind === kind && !window.unlimited,
  );
  const base = {
    id: `${connection.id}:${kind}`,
    connection,
    kind,
    meters,
    banks: banksOf(connection, now),
    inactive: isInactive(connection),
  };
  const drawn = meters
    .filter((window) => !window.notStarted)
    .filter(hasSpan)
    .toSorted((a, b) => (b.used ?? -1) - (a.used ?? -1) || a.end - b.end)[0];
  if (drawn !== undefined) {
    return {
      ...base,
      drawn,
      phase: drawn.end <= now ? "ended" : "current",
      used: drawn.used,
      start: drawn.start,
      end: drawn.end,
      lengthMs: drawn.seconds * 1000,
    };
  }
  const idle = meters.find((window) => window.notStarted && window.seconds !== null);
  if (idle === undefined || idle.seconds === null) return null;
  const lengthMs = idle.seconds * 1000;
  return {
    ...base,
    drawn: idle,
    phase: "idle",
    used: null,
    start: now,
    end: now + lengthMs,
    lengthMs,
  };
}

export interface LaneGroup {
  readonly provider: Provider;
  readonly lanes: readonly Lane[];
}

/** Lanes grouped by provider in the owner's order; providers and accounts with nothing to draw are left out. */
export function laneGroups(
  connections: readonly OverviewConnection[],
  providerOrder: readonly Provider[],
  kind: TimelineKind,
  now: number,
): LaneGroup[] {
  return groupByProvider(connections, providerOrder)
    .map(({ provider, connections: members }) => ({
      provider,
      lanes: members.flatMap((connection) => laneOf(connection, kind, now) ?? []),
    }))
    .filter((group) => group.lanes.length > 0);
}

/** A short name for a limit, for the chips: "Session", "Weekly", "Fable", "Included". */
export function limitName(meter: Pick<MeterWindow, "label" | "window">): string {
  const { label, window } = meter;
  if (label !== "Weekly" || window === null) return label;
  return /^(all models|7 days|weekly)$/i.test(window) ? label : window;
}

export interface UpNextItem {
  readonly id: string;
  readonly connection: OverviewConnection;
  readonly kind: TimelineKind;
  readonly end: number;
  readonly used: number | null;
  readonly inactive: boolean;
}

const kindOrder: readonly TimelineKind[] = ["session", "weekly", "cycle"];

/** Every window that is open now and will reset, soonest first. Sessions that have not started do not reset. */
export function upNextItems(connections: readonly OverviewConnection[], now: number): UpNextItem[] {
  const items: UpNextItem[] = [];
  for (const connection of connections) {
    for (const kind of kindOrder) {
      const lane = laneOf(connection, kind, now);
      if (lane === null || lane.phase !== "current") continue;
      items.push({
        id: lane.id,
        connection,
        kind,
        end: lane.end,
        used: lane.used,
        inactive: lane.inactive,
      });
    }
  }
  return items.toSorted((a, b) => a.end - b.end);
}

const upNextLabels = ["Next 24 Hours", "This Week", "Later"] as const;
type UpNextLabel = (typeof upNextLabels)[number];

export interface UpNextGroup {
  readonly label: UpNextLabel;
  readonly items: readonly UpNextItem[];
}

/** Items in time order under Next 24 Hours, This Week and Later. `limit` keeps only the first N items overall. */
export function upNextGroups(
  items: readonly UpNextItem[],
  now: number,
  limit: number | null,
): UpNextGroup[] {
  const kept = limit === null ? items : items.slice(0, limit);
  const buckets: Record<UpNextLabel, UpNextItem[]> = {
    "Next 24 Hours": [],
    "This Week": [],
    Later: [],
  };
  for (const item of kept) {
    const ahead = item.end - now;
    buckets[ahead < day ? "Next 24 Hours" : ahead < 7 * day ? "This Week" : "Later"].push(item);
  }
  return upNextLabels
    .map((label) => ({ label, items: buckets[label] }))
    .filter((group) => group.items.length > 0);
}

export interface RunningLow {
  readonly id: string;
  readonly connection: OverviewConnection;
  readonly meter: MeterWindow;
  readonly used: number;
  readonly tone: Tone;
  readonly caption: Caption;
  /** When the window resets and room returns. */
  readonly back: number;
  readonly inactive: boolean;
}

/** Windows at or past the warn threshold that will reset, the most used first. */
export function runningLow(
  connections: readonly OverviewConnection[],
  now: number,
  lowThreshold: number,
): RunningLow[] {
  const rows: RunningLow[] = [];
  for (const connection of connections) {
    for (const meter of meterWindows(connection)) {
      const { used, end } = meter;
      if (meter.unlimited || used === null || end === null || end <= now) continue;
      const tone = toneOf(used, lowThreshold);
      const caption = captionOf(used, lowThreshold);
      if (tone === null || tone === "good" || caption === null) continue;
      rows.push({
        id: `${connection.id}:${meter.key}`,
        connection,
        meter,
        used,
        tone,
        caption,
        back: end,
        inactive: isInactive(connection),
      });
    }
  }
  return rows.toSorted((a, b) => b.used - a.used || a.back - b.back);
}

export interface SavedResets {
  readonly connection: OverviewConnection;
  readonly label: string;
  readonly count: number;
  /** Expiries still ahead, soonest first. */
  readonly expiries: readonly number[];
  readonly soon: boolean;
  readonly inactive: boolean;
}

/** Accounts holding banked resets, the one with the earliest expiry first. */
export function savedResets(
  connections: readonly OverviewConnection[],
  now: number,
): SavedResets[] {
  const rows: SavedResets[] = [];
  for (const connection of connections) {
    const banked = bankedOf(connection);
    if (banked === null) continue;
    const expiries = banked.expiries.filter((at) => at > now);
    const count = Math.max(banked.count ?? 0, expiries.length);
    if (count === 0) continue;
    const first = expiries[0];
    rows.push({
      connection,
      label: banked.label,
      count,
      expiries,
      soon: first !== undefined && first - now < expiresSoonMs,
      inactive: isInactive(connection),
    });
  }
  return rows.toSorted((a, b) => (a.expiries[0] ?? Infinity) - (b.expiries[0] ?? Infinity));
}
