/**
 * Pure date maths for the date picker. A day is a `YYYY-MM-DD` string, so there is no time zone to get wrong:
 * every step goes through UTC and never reads the machine's zone. Only `todayIso` looks at the local clock.
 * Weeks start on Monday, in every locale: a deliberate choice, so the grid reads the same everywhere.
 */

/** A calendar day as `YYYY-MM-DD`. Strings of this shape sort in date order. */
export type IsoDate = string;

export interface DateParts {
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
  readonly day: number;
}

const pattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dayMs = 86_400_000;

function utcMs(parts: DateParts): number {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date.getTime();
}

function fromMs(ms: number): DateParts {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Format parts as `YYYY-MM-DD`. */
export function formatIso(parts: DateParts): IsoDate {
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parse `YYYY-MM-DD`. Returns null for any other text and for days that do not exist, such as 2026-02-30. */
export function parseIso(text: string): DateParts | null {
  const match = pattern.exec(text);
  if (match === null) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const back = fromMs(utcMs(parts));
  return back.year === parts.year && back.month === parts.month && back.day === parts.day
    ? parts
    : null;
}

/** The number of days in a month (month is 1 to 12). */
export function daysInMonth(year: number, month: number): number {
  return fromMs(utcMs({ year, month: month + 1, day: 0 })).day;
}

/** Move by whole days, across months and years. */
export function addDays(iso: IsoDate, amount: number): IsoDate {
  const parts = parseIso(iso);
  if (parts === null) return iso;
  return formatIso(fromMs(utcMs(parts) + amount * dayMs));
}

/** Move by whole months and keep the day, clamped to the shorter month: Jan 31 plus one month is Feb 28 (or 29). */
export function addMonths(iso: IsoDate, amount: number): IsoDate {
  const parts = parseIso(iso);
  if (parts === null) return iso;
  const index = parts.year * 12 + (parts.month - 1) + amount;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return formatIso({ year, month, day: Math.min(parts.day, daysInMonth(year, month)) });
}

/** The first day of the month that holds `iso`. */
export function startOfMonth(iso: IsoDate): IsoDate {
  const parts = parseIso(iso);
  return parts === null ? iso : formatIso({ ...parts, day: 1 });
}

/** 0 for Monday through 6 for Sunday. */
export function weekdayIndex(iso: IsoDate): number {
  const parts = parseIso(iso);
  if (parts === null) return 0;
  return (new Date(utcMs(parts)).getUTCDay() + 6) % 7;
}

/** The Monday of the week that holds `iso`. */
export function startOfWeek(iso: IsoDate): IsoDate {
  return addDays(iso, -weekdayIndex(iso));
}

/** The Sunday of the week that holds `iso`. */
export function endOfWeek(iso: IsoDate): IsoDate {
  return addDays(iso, 6 - weekdayIndex(iso));
}

/** True when both days fall in the same calendar month. */
export function sameMonth(a: IsoDate, b: IsoDate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * The six weeks (Monday first) that cover the month holding `iso`: leading days of the previous month, the month,
 * and trailing days of the next. Six rows always, so the calendar keeps one height as months change.
 */
export function monthGrid(iso: IsoDate): IsoDate[][] {
  const first = startOfWeek(startOfMonth(iso));
  return Array.from({ length: 6 }, (_row, week) =>
    Array.from({ length: 7 }, (_cell, day) => addDays(first, week * 7 + day)),
  );
}

/** Pull a day inside `min` and `max`. Either bound may be absent. */
export function clampDate(iso: IsoDate, min?: IsoDate, max?: IsoDate): IsoDate {
  if (min !== undefined && iso < min) return min;
  if (max !== undefined && iso > max) return max;
  return iso;
}

/** True when the day is outside `min` and `max`. */
export function isOutOfRange(iso: IsoDate, min?: IsoDate, max?: IsoDate): boolean {
  return (min !== undefined && iso < min) || (max !== undefined && iso > max);
}

/** The viewer's local date as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): IsoDate {
  return formatIso({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

function utcDate(iso: IsoDate): Date {
  const parts = parseIso(iso);
  return new Date(parts === null ? 0 : utcMs(parts));
}

/** "Oct 12, 2026". */
export function formatShort(iso: IsoDate, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(iso));
}

/** "Monday, October 12, 2026", for a day button's accessible name. */
export function formatFull(iso: IsoDate, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(
    utcDate(iso),
  );
}

/** "October 2026". */
export function formatMonth(iso: IsoDate, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(iso));
}

/** Short weekday names, Monday first: Mon, Tue, and so on. */
export function weekdayLabels(locale = "en-US"): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_slot, index) =>
    formatter.format(utcDate(addDays("2024-01-01", index))),
  );
}
