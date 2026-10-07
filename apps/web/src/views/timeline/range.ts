import type { Clock } from "@headroom/view-model/time";
import type { TimelineKind } from "./lanes.ts";

/**
 * The time axis of the Timeline grid: which instants it covers, where its columns fall, and where a span lands
 * on it. Everything is in milliseconds and the browser's local time zone, and pure so it can be tested.
 */

const hour = 3_600_000;
const day = 24 * hour;

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface Axis {
  readonly kind: TimelineKind;
  readonly base: number;
  readonly end: number;
  /** The start of every column, in order. The columns are equal width. */
  readonly columns: readonly number[];
  /** "14 Days", for the range label. */
  readonly size: string;
  /** What one step moves by, for the stepper's accessible names. */
  readonly stepWord: string;
}

/** Local midnight at the start of the day that holds `t`, moved by `days` calendar days and set to `hours`. */
function localDay(t: number, days: number, hours = 0): number {
  const at = new Date(t);
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days, hours).getTime();
}

function daily(first: number, count: number, every: number): number[] {
  return Array.from({ length: count }, (_, index) => localDay(first, index * every));
}

/**
 * The axis for a window kind. `step` counts whole steps away from now: a week for Weekly, a day for 5-Hour,
 * four weeks for Cycle. Weekly shows the last week and the next; 5-Hour shows 24 hours that start six hours
 * before now, on a two-hour mark; Cycle shows ten weeks, starting four weeks back.
 */
export function axisFor(kind: TimelineKind, now: number, step: number): Axis {
  if (kind === "weekly") {
    const base = localDay(now, -7 + step * 7);
    return {
      kind,
      base,
      end: localDay(base, 14),
      columns: daily(base, 14, 1),
      size: "14 Days",
      stepWord: "Week",
    };
  }
  if (kind === "session") {
    // Two-hour marks on the local clock, six hours before the mark that holds now.
    const midnight = localDay(now, 0);
    const mark = midnight + Math.floor((now - midnight) / (2 * hour)) * 2 * hour;
    const base = mark - 6 * hour + step * day;
    return {
      kind,
      base,
      end: base + day,
      columns: Array.from({ length: 12 }, (_, index) => base + index * 2 * hour),
      size: "24 Hours",
      stepWord: "Day",
    };
  }
  const base = localDay(now, -28 + step * 28);
  return {
    kind,
    base,
    end: localDay(base, 70),
    columns: daily(base, 10, 7),
    size: "10 Weeks",
    stepWord: "4 Weeks",
  };
}

/** "Oct 5". */
export function shortMonth(t: number): string {
  return months[new Date(t).getMonth()] ?? "";
}

export function shortDay(t: number): string {
  const at = new Date(t);
  return `${months[at.getMonth()] ?? ""} ${at.getDate()}`;
}

export function weekday(t: number): string {
  return weekdays[new Date(t).getDay()] ?? "";
}

/** "19:00" or "7:00 PM", from the owner's clock setting. */
export function clockText(t: number, clock: Clock): string {
  const at = new Date(t);
  const minutes = String(at.getMinutes()).padStart(2, "0");
  const hours = at.getHours();
  if (clock === "24h") return `${String(hours).padStart(2, "0")}:${minutes}`;
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

/** "Mon 19:00". */
export function dayClock(t: number, clock: Clock): string {
  return `${weekday(t)} ${clockText(t, clock)}`;
}

/** "Sep 26 – Oct 9 · 14 Days". One date when the range sits inside a single day. */
export function rangeLabel(axis: Axis): string {
  const first = shortDay(axis.base);
  const last = shortDay(axis.end - 1);
  return `${first === last ? first : `${first} – ${last}`} · ${axis.size}`;
}

/** The short reset time written on a bar: weekday and time, time alone, or the date. */
export function resetShort(kind: TimelineKind, t: number, clock: Clock): string {
  if (kind === "weekly") return dayClock(t, clock);
  if (kind === "session") return clockText(t, clock);
  return shortDay(t);
}

/** Where `t` falls on the axis as a percent of its width, or null when it is outside. */
export function positionOf(axis: Pick<Axis, "base" | "end">, t: number): number | null {
  if (t < axis.base || t > axis.end) return null;
  return ((t - axis.base) / (axis.end - axis.base)) * 100;
}

export interface Box {
  /** Percent of the axis width. */
  readonly left: number;
  readonly width: number;
  /** The span begins before the axis does, or ends after it. */
  readonly cutStart: boolean;
  readonly cutEnd: boolean;
  /** The part of the span that is on the axis. */
  readonly from: number;
  readonly to: number;
}

/** The visible part of a span, or null when none of it is on the axis. */
export function placeSpan(
  axis: Pick<Axis, "base" | "end">,
  start: number,
  end: number,
): Box | null {
  const from = Math.max(start, axis.base);
  const to = Math.min(end, axis.end);
  if (to <= from) return null;
  const span = axis.end - axis.base;
  return {
    left: ((from - axis.base) / span) * 100,
    width: ((to - from) / span) * 100,
    cutStart: start < axis.base,
    cutEnd: end > axis.end,
    from,
    to,
  };
}

/** The column that holds `t`, or null when it is outside the axis. */
export function columnOf(axis: Axis, t: number): number | null {
  if (t < axis.base || t >= axis.end) return null;
  let found = 0;
  for (const [index, start] of axis.columns.entries()) if (start <= t) found = index;
  return found;
}

/** The share of a visible box that lies before `now`, 0 to 1. */
export function elapsedShare(box: Pick<Box, "from" | "to">, now: number): number {
  return Math.min(1, Math.max(0, (now - box.from) / (box.to - box.from)));
}
