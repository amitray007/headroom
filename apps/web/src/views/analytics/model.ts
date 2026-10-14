import type { OverviewConnection } from "../../api.ts";
import { isInactive, meterWindows, type MeterWindow } from "@headroom/view-model/accounts";
import type { History, HistoryConnection, HistorySeries } from "@headroom/view-model/history";
import { accountName, planLabel, providerName } from "@headroom/view-model/labels";
import type { Provider } from "@headroom/core/contracts";

/**
 * Analytics model: the stored usage history (`GET /api/history`, or Demo Mode's made-up copy in the same shape)
 * read against the overview's current windows. Every current value comes from the overview, so it matches the
 * other views.
 *
 * Units: percentages are 0..100 of one limit window and are never added across providers or plans. Instants are
 * milliseconds. An unknown value is null, never zero: an hour with no reading stays a gap.
 */

export type RangeDays = 7 | 30 | 90;
type LimitKind = "session" | "weekly" | "cycle";

/** One stored reading of a limit. `used` is null for a gap: an hour with no reading, never zero. */
export interface Reading {
  readonly at: number;
  readonly used: number | null;
}

/** A window that has already reset. */
interface PastWindow {
  readonly key: string;
  readonly start: number;
  /** The reset, or when the limit opened early. */
  readonly end: number;
  /** Highest reading in the window. */
  readonly peak: number;
  /** Hours spent at 100 % before the window ended. */
  readonly hoursAtLimit: number;
  /** The hour it first reached 100 %, if it did. */
  readonly limitHitAt: number | null;
  /** "reset_early" when the limit opened before its reset time. */
  readonly ended: "on_schedule" | "reset_early";
  /** Hourly readings from the start to the end, so a chart can draw how the window filled. */
  readonly curve: readonly Reading[];
}

/** An account's main limit: its current window, the projection, and the closed windows in range. */
interface LimitStory {
  readonly key: string;
  readonly kind: LimitKind;
  readonly start: number;
  readonly end: number;
  /** Latest reading. */
  readonly used: number;
  /** Readings of the current window, oldest first, up to now. */
  readonly readings: readonly Reading[];
  /** Share of the window already passed, 0..1. */
  readonly elapsedShare: number;
  /** Used share over elapsed share: 1 is even pace, 2 is twice as fast. Null right after a reset. */
  readonly pace: number | null;
  /** Linear projection of `used` at the reset; can exceed 100. */
  readonly projectedAtReset: number | null;
  /** When the limit reached or will reach 100 % before its reset; now when it is already there. */
  readonly runsOutAt: number | null;
  /** Complete closed windows in range, oldest first. Only these count toward averages and verdicts. */
  readonly past: readonly PastWindow[];
  /** Closed windows that began before the stored readings or restarted after an early reset: drawn, not judged. */
  readonly fragments: readonly PastWindow[];
  readonly averagePeak: number | null;
}

export interface AccountStory {
  readonly id: string;
  readonly provider: Provider;
  readonly providerName: string;
  /** "Personal", "Work". */
  readonly name: string;
  /** "Max", "Pro", or null when the provider reports none. */
  readonly plan: string | null;
  readonly inactive: boolean;
  /** The overview marks the latest reading out of date. */
  readonly stale: boolean;
  /** The account's main limit: the first weekly or monthly limit in panel order, else its first limit. */
  readonly primary: LimitStory;
  /** What the owner pays a month in US dollars, from the Wallet. Null when not set or not convertible. */
  readonly monthlyCost: number | null;
  /** Why `monthlyCost` is null, in a few words: "Price not set", "Price in EUR, no rate". */
  readonly priceNote: string;
}

export interface Analytics {
  readonly accounts: readonly AccountStory[];
  /** How much stored history there is, so the page can say when it is thin. */
  readonly history: {
    /** Days from the oldest stored reading to now; null when there is none. */
    readonly coverageDays: number | null;
    readonly retentionDays: number;
    /** No account has a stored reading yet. */
    readonly empty: boolean;
  };
}

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Insert a gap where hourly points skip an hour or more, so a missing hour stays unknown. */
function withGaps(readings: readonly Reading[]): Reading[] {
  const out: Reading[] = [];
  for (const reading of readings) {
    const last = out.at(-1);
    if (last !== undefined && reading.at - last.at > 1.5 * hour) {
      out.push({ at: last.at + hour, used: null });
    }
    out.push(reading);
  }
  return out;
}

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : round1(values.reduce((sum, v) => sum + v, 0) / values.length);

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

/** Start of a past window that has no stored start: the window before it ended, else a month or a length back. */
function inferredStart(
  end: number,
  previousEnd: number | undefined,
  monthly: boolean,
  length: number,
): number {
  if (previousEnd !== undefined && previousEnd < end) return previousEnd;
  return monthly ? monthBefore(end) : end - length;
}

/**
 * The closed windows of one limit. A window ends at its reset, at the start of the window after it, at an
 * early-reset event, or where the readings drop from 100 %; the last three are early resets.
 */
function pastWindows(
  window: MeterWindow & { readonly start: number; readonly end: number },
  series: HistorySeries,
  entry: HistoryConnection,
): { complete: PastWindow[]; fragments: PastWindow[] } {
  const length = window.end - window.start;
  const firstReading = series.points[0]?.[0] ?? Number.POSITIVE_INFINITY;
  const ordered = series.windows.toSorted((a, b) => a.end - b.end);
  const earlier = ordered
    .map((entryWindow, index) => ({
      start:
        entryWindow.start ??
        inferredStart(entryWindow.end, ordered[index - 1]?.end, window.kind === "cycle", length),
      end: entryWindow.end,
    }))
    .filter((entryWindow) => entryWindow.start < window.start - minute)
    .toSorted((a, b) => a.start - b.start);
  const complete: PastWindow[] = [];
  const fragments: PastWindow[] = [];
  earlier.forEach((span, index) => {
    const next = earlier[index + 1]?.start ?? window.start;
    let end = Math.min(span.end, next);
    let early = end < span.end - hour;
    const event = entry.events.find(
      (item) =>
        item.detail.kind === "early_reset" &&
        item.metricKey === window.key &&
        item.occurredAt > span.start &&
        item.occurredAt < span.end - hour / 2,
    );
    if (event !== undefined && event.occurredAt < end) {
      end = event.occurredAt;
      early = true;
    }
    let inside = series.points.filter(([at]) => at >= span.start && at < end);
    const hitIndex = inside.findIndex(([, used]) => used >= 100);
    if (hitIndex >= 0) {
      // A drop from 100 % before the reset is an early reset, whether or not an event says so.
      // `inside` holds only points from this window's start up to, not including, its end.
      const drop = inside.findIndex(([, used], i) => i > hitIndex && used < 100);
      if (drop >= 0) {
        end = inside[drop]?.[0] ?? end;
        inside = inside.slice(0, drop);
        early = true;
      }
    }
    if (inside.length === 0) return;
    const hit = inside.find(([, used]) => used >= 100);
    const peak = Math.max(...inside.map(([, used]) => used));
    const record: PastWindow = {
      key: `${window.key}:${span.start}`,
      start: span.start,
      end,
      peak: round1(peak),
      hoursAtLimit: hit === undefined ? 0 : round1((end - hit[0]) / hour),
      limitHitAt: hit?.[0] ?? null,
      ended: early ? "reset_early" : "on_schedule",
      curve: withGaps(inside.map(([at, used]) => ({ at, used }))),
    };
    const previous = earlier[index - 1];
    const clipped = span.start < firstReading - 2 * hour;
    const restarted =
      previous !== undefined && span.start < previous.end - hour && end - span.start < 0.9 * length;
    (clipped || restarted ? fragments : complete).push(record);
  });
  return { complete, fragments };
}

function story(
  window: MeterWindow,
  now: number,
  rangeDays: RangeDays,
  entry: HistoryConnection | undefined,
): LimitStory | null {
  if (window.unlimited || window.used === null) return null;
  if (window.kind === "other" || window.start === null || window.end === null) return null;
  const kind: LimitKind = window.kind;
  const { start, end, used } = window;
  const length = end - start;
  const series = entry?.series.find((item) => item.providerMetricKey === window.key);

  // The current window: stored points inside it, then the live value at now.
  // A window whose reset has passed (a stale or disconnected account) stops at its end: nothing after it counts.
  const stop = Math.min(now, end);
  const stored = (series?.points ?? [])
    .filter(([at]) => at >= start && at < stop)
    .map(([at, value]): Reading => ({ at, used: value }));
  const readings = withGaps([...stored, { at: stop, used }]);

  const elapsedShare = Math.min(1, Math.max(0, (now - start) / length));
  // Too early in a window, a projection only amplifies noise; wait for a tenth of it to pass.
  const pace = elapsedShare >= 0.1 ? used / 100 / elapsedShare : null;
  const projectedAtReset = elapsedShare >= 0.1 ? round1(used / elapsedShare) : null;
  const reachedAt = readings.find((reading) => (reading.used ?? 0) >= 100)?.at ?? stop;
  const runsOutAt =
    end <= now
      ? null
      : used >= 100
        ? reachedAt
        : projectedAtReset !== null && projectedAtReset > 100
          ? start + (100 / used) * (now - start)
          : null;

  // Session limits reset every few hours; no card reads their history.
  const closed =
    kind === "session" || series === undefined || entry === undefined
      ? { complete: [], fragments: [] }
      : pastWindows({ ...window, start, end }, series, entry);
  const cutoff = now - rangeDays * day;
  const past = closed.complete.filter((item) => item.end > cutoff);
  return {
    key: window.key,
    kind,
    start,
    end,
    used,
    readings,
    elapsedShare,
    pace,
    projectedAtReset,
    runsOutAt,
    past,
    fragments: closed.fragments,
    averagePeak: mean(past.map((item) => item.peak)),
  };
}

/** The main limit of an account: the first weekly or monthly one in panel order, else its first. */
function primaryOf(
  connection: OverviewConnection,
  now: number,
  rangeDays: RangeDays,
  entry: HistoryConnection | undefined,
): LimitStory | null {
  const windows = meterWindows(connection).filter(
    (window) =>
      !window.unlimited &&
      window.used !== null &&
      window.kind !== "other" &&
      window.start !== null &&
      window.end !== null,
  );
  const chosen = windows.find((window) => window.kind !== "session") ?? windows[0];
  return chosen === undefined ? null : story(chosen, now, rangeDays, entry);
}

/**
 * Build the Analytics model from the overview's connections and the stored history. `monthlyCosts` maps a
 * connection id to its monthly cost in US dollars; a missing or null entry means the price is not known.
 */
export function buildAnalytics(
  connections: readonly OverviewConnection[],
  history: History,
  now: number,
  rangeDays: RangeDays,
  monthlyCosts: ReadonlyMap<string, number | null>,
  priceNotes: ReadonlyMap<string, string> = new Map(),
): Analytics {
  const accounts: AccountStory[] = [];
  const known: HistoryConnection[] = [];
  for (const connection of connections) {
    const entry = history.connections.find((item) => item.id === connection.id);
    if (entry !== undefined) known.push(entry);
    const primary = primaryOf(connection, now, rangeDays, entry);
    // Accounts with no percentage limits, such as Vercel AI Gateway, are money only and live in the Wallet.
    if (primary === null) continue;
    accounts.push({
      id: connection.id,
      provider: connection.provider,
      providerName: providerName(connection.provider),
      name: accountName(connection),
      plan: planLabel(connection.plan),
      inactive: isInactive(connection),
      stale: connection.stale,
      primary,
      monthlyCost: monthlyCosts.get(connection.id) ?? null,
      priceNote: priceNotes.get(connection.id) ?? "Price not set",
    });
  }
  const firsts = known
    .map((entry) => entry.coverage.firstAt)
    .filter((at): at is number => at !== null);
  return {
    accounts,
    history: {
      coverageDays: firsts.length === 0 ? null : Math.max(0, (now - Math.min(...firsts)) / day),
      retentionDays: history.retentionDays,
      empty: known.every((entry) => entry.coverage.readings === 0),
    },
  };
}
