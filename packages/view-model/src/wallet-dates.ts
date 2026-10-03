import { shortDate } from "./time.ts";

/** Day and month maths for the Wallet. Days are `YYYY-MM-DD` strings; months are `YYYY-MM`. */

export type Cycle = "monthly" | "annual";

export interface Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The UTC day of an epoch-millisecond moment as `YYYY-MM-DD`. */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The owner's local day of a moment as `YYYY-MM-DD`. */
export function localDay(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Parse `YYYY-MM-DD` into numbers; null when it is not a real date. */
export function parseDay(text: string): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? { year, month, day }
    : null;
}

/** The date `months` after the start, keeping the start's day of month and clamping to the month's end. */
function addMonths(start: Day, months: number): string {
  const index = start.year * 12 + (start.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(start.day, lastDay))).toISOString().slice(0, 10);
}

/** Roll a renewal date forward by its cycle until it is on or after `today` (`YYYY-MM-DD`). */
export function rollForward(renewsOn: string, cycle: Cycle, today: string): string | null {
  const start = parseDay(renewsOn);
  if (start === null) return null;
  const step = cycle === "annual" ? 12 : 1;
  let next = addMonths(start, 0);
  for (let count = 1; next < today; count += 1) next = addMonths(start, count * step);
  return next;
}

/** "Oct 12" for `2026-10-12`; the text itself when it is not a day. */
export function dayLabel(text: string): string {
  const at = parseDay(text);
  return at === null ? text : shortDate(new Date(at.year, at.month - 1, at.day).getTime());
}

/** "Oct 2026" for `2026-10`; the text itself when it is not a month. */
export function monthLabel(text: string): string {
  const at = /^(\d{4})-(\d{2})$/.exec(text);
  if (at === null) return text;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(Number(at[1]), Number(at[2]) - 1, 1)));
}
