/**
 * The approved time wording. Every function takes `now` so tests and ticking components agree.
 * Day boundaries use the browser's local time zone.
 */

export type TimeStyle = "countdown" | "exact";
export type Clock = "24h" | "12h";
export type WhenKind = "until" | "ago";

const minute = 60_000;
const hour = 60 * minute;
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

/** "52 min", "3 h", "1 day 6 h", "12 days"; null under one minute. */
function span(ms: number): string | null {
  if (ms < minute) return null;
  if (ms < hour) return `${Math.floor(ms / minute)} min`;
  if (ms < day) {
    const hours = Math.floor(ms / hour);
    const minutes = Math.floor((ms % hour) / minute);
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }
  const days = Math.floor(ms / day);
  const unit = days === 1 ? "day" : "days";
  if (ms < 7 * day) {
    const hours = Math.floor((ms % day) / hour);
    return hours === 0 ? `${days} ${unit}` : `${days} ${unit} ${hours} h`;
  }
  return `${days} days`;
}

export function countdown(target: number, now: number): string {
  return span(target - now) ?? "Under 1 min";
}

export function age(past: number, now: number): string {
  const text = span(now - past);
  return text === null ? "Just now" : `${text} ago`;
}

/** A fixed offset uses UTC getters, so request formatting never changes the process time zone. */
function calendar(t: number, tzOffsetMinutes?: number) {
  const date = new Date(t + (tzOffsetMinutes ?? 0) * minute);
  const utc = tzOffsetMinutes !== undefined;
  return {
    year: utc ? date.getUTCFullYear() : date.getFullYear(),
    month: utc ? date.getUTCMonth() : date.getMonth(),
    day: utc ? date.getUTCDate() : date.getDate(),
    weekday: utc ? date.getUTCDay() : date.getDay(),
    hours: utc ? date.getUTCHours() : date.getHours(),
    minutes: utc ? date.getUTCMinutes() : date.getMinutes(),
  };
}

type Calendar = ReturnType<typeof calendar>;

function clockTime(date: Calendar, clock: Clock): string {
  const minutes = String(date.minutes).padStart(2, "0");
  const hours = date.hours;
  if (clock === "24h") return `${String(hours).padStart(2, "0")}:${minutes}`;
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

function sameDay(a: Calendar, b: Calendar): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** "Oct 5". Omit the offset to use the browser's local time zone. */
export function shortDate(t: number, tzOffsetMinutes?: number): string {
  const date = calendar(t, tzOffsetMinutes);
  return `${months[date.month] ?? ""} ${date.day}`;
}

function dayAndTime(t: number, clock: Clock, tzOffsetMinutes?: number): string {
  const date = calendar(t, tzOffsetMinutes);
  return `${weekdays[date.weekday] ?? ""}, ${shortDate(t, tzOffsetMinutes)} · ${clockTime(date, clock)}`;
}

/** "15:06" for today, otherwise "Wed, Oct 8 · 08:14". */
export function exact(t: number, now: number, clock: Clock, tzOffsetMinutes?: number): string {
  const date = calendar(t, tzOffsetMinutes);
  return sameDay(date, calendar(now, tzOffsetMinutes))
    ? clockTime(date, clock)
    : dayAndTime(t, clock, tzOffsetMinutes);
}

/** Hover title: "Today · 15:06", otherwise "Wed, Oct 8 · 08:14". */
export function exactFull(t: number, now: number, clock: Clock, tzOffsetMinutes?: number): string {
  const date = calendar(t, tzOffsetMinutes);
  return sameDay(date, calendar(now, tzOffsetMinutes))
    ? `Today · ${clockTime(date, clock)}`
    : dayAndTime(t, clock, tzOffsetMinutes);
}

export interface ResolvedWhen {
  /** Word that joins a caller's prefix to the text: "in" for a countdown, otherwise empty. */
  readonly lead: "in" | "";
  readonly text: string;
  readonly title: string;
}

/** What the When component shows for an instant under the owner's time settings. */
export function resolveWhen(
  kind: WhenKind,
  at: number,
  now: number,
  style: {
    readonly timeStyle: TimeStyle;
    readonly clock: Clock;
    readonly tzOffsetMinutes?: number;
  },
): ResolvedWhen {
  const duration = kind === "until" ? countdown(at, now) : age(at, now);
  if (style.timeStyle === "countdown") {
    // "Resets in under 1 min" reads as a sentence; the standalone form keeps its capital.
    if (kind === "until" && duration === "Under 1 min")
      return {
        lead: "in",
        text: "under 1 min",
        title: exactFull(at, now, style.clock, style.tzOffsetMinutes),
      };
    return {
      lead: kind === "until" ? "in" : "",
      text: duration,
      title: exactFull(at, now, style.clock, style.tzOffsetMinutes),
    };
  }
  const today = sameDay(calendar(at, style.tzOffsetMinutes), calendar(now, style.tzOffsetMinutes));
  const text = exact(at, now, style.clock, style.tzOffsetMinutes);
  return { lead: "", text: kind === "until" && today ? `at ${text}` : text, title: duration };
}
