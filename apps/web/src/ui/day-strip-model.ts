import { addDays, parseIso } from "./calendar.ts";

/**
 * Pure maths for the day strip. A day is a `YYYY-MM-DD` string and every step goes through UTC, so no time zone
 * can move a mark to the wrong day. The strip runs from `start` (offset 0) to `start + days`.
 */

const dayMs = 86_400_000;

/** The day offsets that carry a tick: today, then one, two and three weeks on, then thirty days on. */
const tickDays = [0, 7, 14, 21, 30] as const;

/** Whole days from `start` to `date`, negative before it. Null when either is not a real `YYYY-MM-DD` day. */
export function dayOffset(start: string, date: string): number | null {
  const from = parseIso(start);
  const to = parseIso(date);
  if (from === null || to === null) return null;
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / dayMs);
}

/** Where an offset sits along the strip, 0 (start) to 1 (the last day). */
export function fractionOf(offset: number, days: number): number {
  if (days <= 0) return 0;
  return Math.min(1, Math.max(0, offset / days));
}

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Oct 11" for a day, in UTC. */
export function monthDayText(date: string): string {
  const parts = parseIso(date);
  if (parts === null) return date;
  return monthDay.format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

export interface Tick {
  readonly offset: number;
  readonly fraction: number;
  /** "Today", or "Oct 11". */
  readonly label: string;
}

/** The ticks that fit in `days`. The first is always today. */
export function ticksFor(start: string, days: number): Tick[] {
  return tickDays
    .filter((offset) => offset === 0 || offset <= days)
    .map((offset) => ({
      offset,
      fraction: fractionOf(offset, days),
      label: offset === 0 ? "Today" : monthDayText(addDays(start, offset)),
    }));
}

export interface PlacedMark {
  readonly key: string;
  readonly offset: number;
  readonly fraction: number;
  /** Position among marks on the same day, 0 first. */
  readonly stack: number;
  /** How many marks share this day. */
  readonly stackOf: number;
  /** Index in the original list, for reading the mark's data back. */
  readonly index: number;
}

/** Horizontal gap between stacked dots, in pixels. */
const stackStep = 12;

/** How far to move a stacked dot sideways so the group stays centred on its day, in pixels. */
export function stackShift(stack: number, stackOf: number): number {
  return (stack - (stackOf - 1) / 2) * stackStep;
}

/**
 * Marks that fall on the strip, in date order (input order within a day, which is also the stacking order). Marks
 * with an invalid date, or a day before the start or after the last day, are left out.
 */
export function placeMarks(
  start: string,
  days: number,
  marks: readonly { readonly key: string; readonly date: string }[],
): PlacedMark[] {
  const inRange = marks.flatMap((mark, index) => {
    const offset = dayOffset(start, mark.date);
    return offset === null || offset < 0 || offset > days ? [] : [{ key: mark.key, offset, index }];
  });
  const ordered = inRange.toSorted((a, b) => a.offset - b.offset || a.index - b.index);
  return ordered.map((mark) => {
    const same = ordered.filter((other) => other.offset === mark.offset);
    return {
      key: mark.key,
      offset: mark.offset,
      index: mark.index,
      fraction: fractionOf(mark.offset, days),
      stack: same.findIndex((other) => other.index === mark.index),
      stackOf: same.length,
    };
  });
}

/**
 * The ticks whose labels fit. `width` is the strip's full width, `edge` the inset of the track on each side, and
 * `widths` the measured width of each tick's label (same order as `ticks`). The first label is left-aligned to the
 * strip and the last right-aligned; the others centre on their tick. The first and last always show. Each tick
 * between them shows only if its label clears the last shown label and the final label by `gap` pixels, so labels
 * never overlap. Ticks always draw; only their labels drop. Returns the offsets of the ticks that keep a label.
 */
export function labelsToShow(
  ticks: readonly Pick<Tick, "offset" | "fraction">[],
  widths: readonly number[],
  layout: { readonly width: number; readonly edge: number; readonly gap?: number },
): Set<number> {
  const { width, edge, gap = 8 } = layout;
  const shown = new Set<number>();
  const last = ticks.length - 1;
  if (last < 0) return shown;
  const track = Math.max(0, width - edge * 2);
  const box = (index: number): { left: number; right: number } => {
    const w = widths[index] ?? 0;
    if (index === 0) return { left: 0, right: w };
    if (index === last) return { left: width - w, right: width };
    const at = edge + (ticks[index]?.fraction ?? 0) * track;
    return { left: at - w / 2, right: at + w / 2 };
  };
  shown.add(ticks[0]?.offset ?? 0);
  let reach = box(0).right;
  const end = box(last);
  for (let index = 1; index < last; index += 1) {
    const here = box(index);
    if (here.left - reach >= gap && end.left - here.right >= gap) {
      shown.add(ticks[index]?.offset ?? index);
      reach = here.right;
    }
  }
  if (last > 0) shown.add(ticks[last]?.offset ?? last);
  return shown;
}
