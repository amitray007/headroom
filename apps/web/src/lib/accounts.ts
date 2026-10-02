import type { Metric, OverviewConnection } from "../api.ts";
import { presentPanel, type Cell } from "./present.ts";
import { toneOf, type Tone } from "./tone.ts";

/**
 * Facts about an account that more than one view needs, derived from the same panel the Overview draws: whether
 * it is inactive, how long each meter's window is, how much room it has left, and how urgent it is. Pure
 * functions; an unknown value stays null, never zero.
 */

type MeterCell = Extract<Cell, { kind: "meter" }>;

/** A session window is at most this long; the providers' are 5 hours. */
const sessionMaxSeconds = 6 * 3600;
/** A weekly window is 7 days give or take a day. */
const weekSeconds = 7 * 86_400;
const weekToleranceSeconds = 86_400;
/** A fixed window this long or longer is a billing period, not a rolling limit. */
const cycleMinSeconds = 25 * 86_400;

/** The account is not being read right now: paused by the owner, or it needs a new sign-in. */
export function isInactive(connection: Pick<OverviewConnection, "state">): boolean {
  return connection.state === "paused" || connection.state === "reconnect_required";
}

/** One meter, named the way the panel names it. */
interface MeterRef {
  readonly key: string;
  readonly label: string;
  readonly window: string | null;
  /** Name for sentences, such as "Weekly Sonnet". */
  readonly short: string;
  readonly used: number | null;
  readonly resetsAt: number | null;
  /** A session window whose clock has not started: nothing was used since the last reset. */
  readonly notStarted: boolean;
}

type WindowKind = "session" | "weekly" | "cycle" | "other";

/** A meter and the span of time it measures. Instants are in milliseconds, the length in seconds. */
export interface MeterWindow extends MeterRef {
  readonly unlimited: boolean;
  /** Null when the provider gives no way to tell. */
  readonly seconds: number | null;
  readonly start: number | null;
  readonly end: number | null;
  readonly kind: WindowKind;
}

/** The same clock time one calendar month before `end`, clamped to the shorter month, in UTC. */
function monthBefore(end: number): number {
  const at = new Date(end);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const daysBefore = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Date.UTC(
    year,
    month - 1,
    Math.min(at.getUTCDate(), daysBefore),
    at.getUTCHours(),
    at.getUTCMinutes(),
    at.getUTCSeconds(),
    at.getUTCMilliseconds(),
  );
}

interface Length {
  readonly seconds: number | null;
  /** The scope names a billing period rather than a rolling window. */
  readonly cycle: boolean;
}

function lengthOf(metric: Metric | undefined, end: number | null): Length {
  const scope = metric?.scope ?? "";
  const rolling = /^window:(\d+)s$/.exec(scope)?.[1];
  if (rolling !== undefined) return { seconds: Number(rolling), cycle: false };
  if (scope === "window:weekly") return { seconds: weekSeconds, cycle: false };
  if (scope === "month") {
    return { seconds: end === null ? null : (end - monthBefore(end)) / 1000, cycle: true };
  }
  if (scope === "billing_cycle") {
    const start = metric?.windowStart ?? null;
    const stop = metric?.windowEnd ?? end;
    return { seconds: start === null || stop === null ? null : (stop - start) / 1000, cycle: true };
  }
  return { seconds: null, cycle: false };
}

function kindOf({ seconds, cycle }: Length): WindowKind {
  if (cycle) return "cycle";
  if (seconds === null) return "other";
  if (seconds <= sessionMaxSeconds) return "session";
  if (Math.abs(seconds - weekSeconds) <= weekToleranceSeconds) return "weekly";
  return seconds >= cycleMinSeconds ? "cycle" : "other";
}

function refOf(cell: MeterCell): MeterRef {
  return {
    key: cell.key,
    label: cell.label,
    window: cell.window,
    short: cell.short,
    used: cell.used,
    resetsAt: cell.resetsAt,
    notStarted: cell.resetWords === "not_started",
  };
}

function metersOf(connection: OverviewConnection): MeterCell[] {
  return presentPanel(connection).cells.filter((cell): cell is MeterCell => cell.kind === "meter");
}

/** Every meter the panel shows, with its window. The end is the reset; the start is reported or end minus length. */
export function meterWindows(connection: OverviewConnection): MeterWindow[] {
  const metrics = new Map(
    (connection.snapshot?.metrics ?? []).map((metric) => [metric.providerMetricKey, metric]),
  );
  return metersOf(connection).map((cell) => {
    const metric = metrics.get(cell.key);
    const end = cell.resetsAt ?? metric?.windowEnd ?? null;
    const length = lengthOf(metric, end);
    const reported = metric?.windowStart ?? null;
    const start =
      reported ?? (end !== null && length.seconds !== null ? end - length.seconds * 1000 : null);
    return Object.assign(refOf(cell), {
      unlimited: cell.unlimited,
      seconds: length.seconds,
      start,
      end,
      kind: kindOf(length),
    });
  });
}

/** How much room an account has. `unit` says what `left` counts: percent of the limit, or credits. */
export interface Room {
  readonly left: number | null;
  readonly unit: "percent" | "credits";
  /** The window that sets `left`; null for a balance or when nothing is known. */
  readonly limiting: MeterRef | null;
  /** The windows `left` was taken from. */
  readonly windows: readonly MeterRef[];
}

function leftOf(ref: MeterRef): number | null {
  if (ref.notStarted) return 100;
  return ref.used === null ? null : Math.min(100, Math.max(0, 100 - ref.used));
}

/** The tightest of some windows. Unknown and unlimited windows do not count as full or empty. */
function tightestRoom(windows: readonly MeterRef[]): Room {
  let limiting: MeterRef | null = null;
  let left: number | null = null;
  for (const ref of windows) {
    const room = leftOf(ref);
    if (room !== null && (left === null || room < left)) {
      left = room;
      limiting = ref;
    }
  }
  return { left, unit: "percent", limiting, windows };
}

function balanceRoom(connection: OverviewConnection): Room {
  const amounts = presentPanel(connection).cells.filter((cell) => cell.kind === "amount");
  const balance = amounts.find((cell) => cell.key === "credits.balance")?.value ?? null;
  const spent = amounts.find((cell) => cell.key === "credits.total_used")?.value ?? null;
  const total = balance === null || spent === null ? null : balance + spent;
  if (balance === null) return { left: null, unit: "credits", limiting: null, windows: [] };
  if (total === null || total <= 0)
    return { left: balance, unit: "credits", limiting: null, windows: [] };
  return { left: (balance / total) * 100, unit: "percent", limiting: null, windows: [] };
}

/** The one meter that stands for the whole account, for providers whose other meters are parts of it. */
const totalKeys: Partial<Record<OverviewConnection["provider"], string>> = {
  cursor: "included.total_percent",
  grok: "weekly_pool.used_percent",
};

/**
 * The room left, for comparing accounts of one provider. Claude and Codex take the tightest of session, weekly
 * and model windows; Cursor and Grok take their total; Antigravity and Copilot the tightest of all windows;
 * Vercel AI Gateway the balance as a percent of everything granted, or the balance itself when the total is unknown.
 */
export function roomOf(connection: OverviewConnection): Room {
  if (connection.provider === "vercel_ai_gateway") return balanceRoom(connection);
  const total = totalKeys[connection.provider];
  const meters = metersOf(connection).filter((cell) => total === undefined || cell.key === total);
  return tightestRoom(meters.map(refOf));
}

const toneOrder: Readonly<Record<Tone, number>> = { bad: 0, warn: 1, good: 2 };
/** An account with no known room sorts after every account that has one. */
const unknownRank = 3000;

/**
 * A sort key, lowest first: accounts whose tightest window reads bad, then warn, then good, then unknown; within a
 * tone, the most used first. The caller sets inactive accounts apart.
 */
export function urgencyRank(connection: OverviewConnection, lowThreshold: number): number {
  const room = roomOf(connection);
  if (room.left === null || room.unit !== "percent") return unknownRank;
  const used = 100 - room.left;
  const tone = toneOf(used, lowThreshold);
  return tone === null ? unknownRank : toneOrder[tone] * 1000 - used;
}
