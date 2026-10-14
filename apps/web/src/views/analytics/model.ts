import type { Provider } from "@headroom/core/contracts";

import type { OverviewConnection } from "../../api.ts";
import { isInactive, meterWindows, type MeterWindow } from "@headroom/view-model/accounts";
import { accountName, planLabel, providerName } from "@headroom/view-model/labels";

/**
 * MOCKUP ONLY. Synthetic usage history for the Analytics mockup, derived from the demo connections so every
 * current value matches the other views. A real build reads stored snapshots; nothing here is provider data.
 *
 * Units: percentages are 0..100 of one limit window and are never added across providers or plans. Instants are
 * milliseconds. An unknown value is null, never zero.
 */

export type RangeDays = 7 | 30 | 90;
type LimitKind = "session" | "weekly" | "cycle";
type Fit = "room" | "good" | "tight";

/** One stored reading of a limit. `used` is null when the refresh failed: a gap, not zero. */
export interface Reading {
  readonly at: number;
  readonly used: number | null;
}

/** A window that has already reset. */
interface PastWindow {
  readonly key: string;
  readonly start: number;
  readonly end: number;
  /** Highest reading in the window. */
  readonly peak: number;
  /** Hours spent at 100 % before the window reset. */
  readonly hoursAtLimit: number;
  /** When it first reached 100 %, if it did. */
  readonly limitHitAt: number | null;
  /** "reset_early" when the owner spent a reset credit. */
  readonly ended: "on_schedule" | "reset_early";
  /** Hourly readings from the start to the end, so a chart can draw how the window filled. */
  readonly curve: readonly Reading[];
}

/** One limit of one account: its current window, the projection, and the closed windows in range. */
interface LimitStory {
  readonly key: string;
  /** As the panel names it: "Weekly", "Session", "Included". */
  readonly label: string;
  /** For sentences: "Weekly Opus". */
  readonly short: string;
  readonly kind: LimitKind;
  /** "5 hours", "7 days", "Monthly". */
  readonly windowWords: string;
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
  /** When the projection reaches 100 %, if that is before the reset. */
  readonly runsOutAt: number | null;
  readonly past: readonly PastWindow[];
  readonly averagePeak: number | null;
  /** 100 minus the average peak. */
  readonly averageUnused: number | null;
  readonly hoursAtLimit: number;
  /** The same figures for the period of equal length before the range, for comparison. */
  readonly previousAveragePeak: number | null;
  readonly previousHoursAtLimit: number;
  readonly readingCount: number;
  readonly missedReadings: number;
}

/** One local day of the range: which accounts sat at their main limit, and for how long. */
interface DayStory {
  /** Local midnight. */
  readonly start: number;
  readonly atLimit: readonly {
    readonly id: string;
    readonly provider: Provider;
    readonly name: string;
    readonly plan: string | null;
    readonly limit: string;
    readonly hours: number;
  }[];
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
  readonly limits: readonly LimitStory[];
  /** The account's main limit: the first weekly or monthly limit in panel order, else its first limit. */
  readonly primary: LimitStory;
  /**
   * Share of this account's usage per hour of the week, 168 values that sum to 1. Index is day * 24 + hour with
   * Monday as day 0, in local time.
   */
  readonly heat: readonly number[];
  /** Synthetic subscription price in USD per month, standing in for the Wallet. Null when not set. */
  readonly monthlyCost: number | null;
  readonly fit: Fit;
}

/** Accounts of one provider and plan, whose windows have the same size and can be added. */
interface Pool {
  readonly key: string;
  readonly provider: Provider;
  readonly providerName: string;
  readonly plan: string | null;
  readonly limitLabel: string;
  readonly members: readonly {
    readonly id: string;
    readonly name: string;
    readonly used: number;
  }[];
  /** 100 per member. */
  readonly capacity: number;
  readonly used: number;
}

/** A provider with several accounts that cannot be pooled, and why. */
interface Unpooled {
  readonly provider: Provider;
  readonly providerName: string;
  readonly reason: string;
}

interface LimitHit {
  readonly key: string;
  readonly accountId: string;
  readonly provider: Provider;
  readonly account: string;
  readonly limit: string;
  readonly at: number;
  readonly hoursAtLimit: number;
  readonly ended: PastWindow["ended"];
}

export interface Analytics {
  readonly rangeDays: RangeDays;
  readonly accounts: readonly AccountStory[];
  /** Accounts with no percentage limits, such as Vercel AI Gateway: money only, so they live in the Wallet. */
  readonly moneyOnly: number;
  readonly averagePeak: number | null;
  readonly averageUnused: number | null;
  readonly hoursAtLimit: number;
  /** The same figures for the period of equal length before the range. */
  readonly previousAveragePeak: number | null;
  readonly previousHoursAtLimit: number;
  readonly accountsAtLimit: number;
  /** Accounts whose primary limit is projected to reach 100 % before its reset, soonest first. */
  readonly runningOut: readonly AccountStory[];
  readonly windowsClosed: number;
  readonly pools: readonly Pool[];
  readonly unpooled: readonly Unpooled[];
  /** Every account weighted equally, 168 values that sum to 1. */
  readonly heat: readonly number[];
  /** Every local day of the range, oldest first. */
  readonly days: readonly DayStory[];
  /** Times a limit reached 100 % in range, newest first. */
  readonly hits: readonly LimitHit[];
  readonly readingCount: number;
  readonly missedReadings: number;
}

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** mulberry32: a small seeded generator, so the mockup reads the same on every load. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Weight of one hour of the week for an account: weekday work hours, a lighter evening, quieter weekends. */
function hourWeight(at: number, profile: { night: number; weekend: number }): number {
  const date = new Date(at);
  const weekday = (date.getDay() + 6) % 7;
  const h = date.getHours() + date.getMinutes() / 60;
  const work = Math.exp(-((h - 11.5) ** 2) / 8) + 0.8 * Math.exp(-((h - 16) ** 2) / 6);
  const evening = profile.night * Math.exp(-((h - 22) ** 2) / 3);
  const base = 0.02 + work + evening;
  return weekday >= 5 ? base * profile.weekend : base;
}

/** A stable number in 0..1 for a key and an index, independent of draw order. */
function noise(key: number, index: number): number {
  const x = Math.sin((key % 100_003) * 12.9898 + index * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Some days are heavy, some light, and about one in ten is a day off. */
function dayFactor(key: number, at: number): number {
  const r = noise(key, Math.floor(at / day));
  return r < 0.1 ? 0.08 : 0.45 + r * 1.3;
}

/**
 * MOCKUP: how full past windows ran, by provider and plan. Without an entry, past windows follow the current pace.
 * These give the demo a mix of plans that are too small, about right and too big.
 */
const appetiteByPlan: Record<string, number> = {
  "codex:pro": 62,
  "grok:supergrok heavy": 30,
};

const stepOf: Record<LimitKind, number> = {
  session: 5 * minute,
  weekly: 30 * minute,
  cycle: 3 * hour,
};
const windowWords: Record<LimitKind, string> = {
  session: "5 hours",
  weekly: "7 days",
  cycle: "Monthly",
};

/** Synthetic monthly prices by provider and plan, standing in for owner-entered Wallet costs. */
function priceOf(provider: Provider, plan: string | null): number | null {
  const key = `${provider}:${(plan ?? "").toLowerCase()}`;
  const prices: Record<string, number> = {
    "codex:plus": 20,
    "codex:pro": 200,
    "claude:max": 200,
    "claude:pro": 20,
    "grok:supergrok": 30,
    "grok:supergrok heavy": 300,
    "antigravity:google ai pro": 19.99,
    "copilot:": 10,
    "cursor:": 20,
  };
  return prices[key] ?? null;
}

function story(
  connection: OverviewConnection,
  window: MeterWindow,
  now: number,
  rangeDays: RangeDays,
  profile: { night: number; weekend: number },
  rng: () => number,
  gappy: boolean,
  canResetEarly: boolean,
): LimitStory | null {
  if (window.unlimited || window.used === null) return null;
  if (window.kind === "other" || window.start === null || window.end === null) return null;
  const kind: LimitKind = window.kind;
  const { start, end } = window;
  const used = window.used;
  const length = end - start;
  const step = stepOf[kind];

  // The current window: cumulative weight up to now, scaled so the last reading equals the reported value.
  const times: number[] = [];
  for (let at = start; at <= now; at += step) times.push(at);
  if (times.at(-1) !== now) times.push(now);
  // Jitter from a keyed hash, not the shared generator: the number of readings grows with time, and drawing
  // from the generator here would reshuffle every later draw on each load.
  const jitterKey = hash(`${connection.id}:${window.key}:now`);
  const weights = times.map(
    (at, index) => hourWeight(at, profile) * (0.6 + noise(jitterKey, index) * 0.8),
  );
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  let running = 0;
  const gapFrom = Math.floor(times.length * 0.42);
  const gapTo = gapFrom + Math.max(2, Math.round((3 * hour) / step));
  const readings: Reading[] = times.map((at, index) => {
    running += weights[index] ?? 0;
    const value = round1((running / total) * used);
    const missed =
      gappy && kind !== "session" && index >= gapFrom && index < gapTo && index < times.length - 1;
    return { at, used: missed ? null : value };
  });

  const elapsedShare = Math.min(1, Math.max(0, (now - start) / length));
  // Too early in a window, a projection only amplifies noise; wait for a tenth of it to pass.
  const pace = elapsedShare >= 0.1 ? used / 100 / elapsedShare : null;
  const projectedAtReset = elapsedShare >= 0.1 ? round1(used / elapsedShare) : null;
  const runsOutAt =
    projectedAtReset !== null && projectedAtReset > 100 && used < 100
      ? start + (100 / used) * (now - start)
      : null;

  // Closed windows back to the start of the range. Their appetite follows the current pace, with noise.
  const planKey = `${connection.provider}:${(connection.plan ?? "").toLowerCase()}`;
  const appetite = appetiteByPlan[planKey] ?? Math.min(112, Math.max(18, projectedAtReset ?? used));
  const curveKey = hash(`${connection.id}:${window.key}`);
  const all: PastWindow[] = [];
  const cutoff = now - rangeDays * day;
  // Only the range itself: nothing reads the period before it, and each window's hourly curve costs time.
  const rangeStart = now - rangeDays * day;
  let earlyUsed = false;
  // Session limits reset every few hours; no card reads their history, and 90 days of them is hundreds of windows.
  const historyFrom = kind === "session" ? start : rangeStart;
  for (let windowEnd = start; windowEnd > historyFrom; windowEnd -= length) {
    const windowStart = windowEnd - length;
    // An account that banks reset credits spent one on the window before last, so the mockup shows that case.
    const forced = canResetEarly && kind === "weekly" && all.length === 1;
    const raw = forced ? 108 : appetite * (0.7 + rng() * 0.6);
    const hit = raw >= 100;
    const peak = hit ? 100 : round1(Math.max(3, raw));
    // Hourly cumulative use along the owner's rhythm; the limit is reached where the curve crosses 100.
    const curveStep = kind === "session" ? step : hour;
    const curveTimes: number[] = [];
    for (let at = windowStart; at <= windowEnd; at += curveStep) curveTimes.push(at);
    const curveWeights = curveTimes.map(
      (at, index) =>
        hourWeight(at, profile) * dayFactor(curveKey, at) * (0.7 + 0.6 * noise(curveKey, index)),
    );
    const curveTotal = curveWeights.reduce((sum, w) => sum + w, 0) || 1;
    let filled = 0;
    const scaled = curveWeights.map((w) => ((filled += w) / curveTotal) * raw);
    const crossing = hit ? scaled.findIndex((value) => value >= 100) : -1;
    const hitAt = crossing < 0 ? null : (curveTimes[crossing] ?? null);
    const resetEarly = hit && canResetEarly && !earlyUsed && kind === "weekly";
    if (resetEarly) earlyUsed = true;
    const ends = resetEarly && hitAt !== null ? hitAt + 2 * hour : windowEnd;
    const curve: Reading[] = curveTimes
      .map((at, index) => ({ at, used: round1(Math.min(100, scaled[index] ?? 0)) }))
      .filter((reading) => reading.at <= ends);
    all.push({
      key: `${window.key}:${windowStart}`,
      start: windowStart,
      end: ends,
      peak,
      hoursAtLimit: hitAt === null ? 0 : round1((ends - hitAt) / hour),
      limitHitAt: hitAt,
      ended: resetEarly ? "reset_early" : "on_schedule",
      curve,
    });
  }
  all.reverse();
  const past = all.filter((entry) => entry.end > cutoff);
  const earlier = all.filter((entry) => entry.end <= cutoff);

  const mean = (values: readonly number[]): number | null =>
    values.length === 0 ? null : round1(values.reduce((sum, v) => sum + v, 0) / values.length);
  const averagePeak = mean(past.map((entry) => entry.peak));
  const perWindowReadings = Math.round(length / step);
  return {
    key: window.key,
    label: window.label,
    short: window.short,
    kind,
    windowWords: windowWords[kind],
    start,
    end,
    used,
    readings,
    elapsedShare,
    pace,
    projectedAtReset,
    runsOutAt,
    past,
    averagePeak,
    averageUnused: averagePeak === null ? null : round1(100 - averagePeak),
    hoursAtLimit: round1(past.reduce((sum, entry) => sum + entry.hoursAtLimit, 0)),
    previousAveragePeak: mean(earlier.map((entry) => entry.peak)),
    previousHoursAtLimit: round1(earlier.reduce((sum, entry) => sum + entry.hoursAtLimit, 0)),
    readingCount: readings.length + past.length * perWindowReadings,
    missedReadings: readings.filter((reading) => reading.used === null).length,
  };
}

function heatOf(profile: { night: number; weekend: number }, key: number): number[] {
  // Any Monday at local midnight; only the weekday and hour matter.
  const monday = new Date(2026, 9, 12).getTime();
  const raw = Array.from(
    { length: 168 },
    (_, index) => hourWeight(monday + index * hour, profile) * (0.5 + noise(key, index)),
  );
  const total = raw.reduce((sum, w) => sum + w, 0);
  return raw.map((w) => w / total);
}

function primaryOf(limits: readonly LimitStory[]): LimitStory | undefined {
  return limits.find((limit) => limit.kind !== "session") ?? limits[0];
}

function fitOf(limit: LimitStory): Fit {
  const hitWindows = limit.past.filter((entry) => entry.hoursAtLimit > 0).length;
  if (hitWindows >= 2 || (limit.averagePeak ?? 0) >= 90) return "tight";
  if ((limit.averagePeak ?? 100) < 45) return "room";
  return "good";
}

/** Build the whole Analytics mockup from the demo connections. */
export function buildAnalytics(
  connections: readonly OverviewConnection[],
  now: number,
  rangeDays: RangeDays,
): Analytics {
  let moneyOnly = 0;
  const accounts: AccountStory[] = [];
  connections.forEach((connection, index) => {
    const rng = random(hash(connection.id));
    const profile = { night: 0.2 + rng() * 0.7, weekend: 0.15 + rng() * 0.6 };
    const gappy = index % 4 === 1;
    const canResetEarly = connection.provider === "codex";
    const limits = meterWindows(connection)
      .map((window) =>
        story(connection, window, now, rangeDays, profile, rng, gappy, canResetEarly),
      )
      .filter((limit): limit is LimitStory => limit !== null);
    const primary = primaryOf(limits);
    if (primary === undefined) {
      moneyOnly += 1;
      return;
    }
    accounts.push({
      id: connection.id,
      provider: connection.provider,
      providerName: providerName(connection.provider),
      name: accountName(connection),
      plan: planLabel(connection.plan),
      inactive: isInactive(connection),
      limits,
      primary,
      heat: heatOf(profile, hash(`${connection.id}:heat`)),
      monthlyCost: priceOf(connection.provider, connection.plan),
      fit: fitOf(primary),
    });
  });

  const primaries = accounts.map((account) => account.primary);
  const peaks = primaries.map((limit) => limit.averagePeak).filter((p): p is number => p !== null);
  const averagePeak =
    peaks.length === 0 ? null : round1(peaks.reduce((s, p) => s + p, 0) / peaks.length);

  // Pools: same provider and same plan, comparing the same limit label.
  const groups = new Map<string, AccountStory[]>();
  for (const account of accounts) {
    const key = `${account.provider}:${account.plan ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), account]);
  }
  const pools: Pool[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const label = members[0]?.primary.label ?? "";
    const same = members.every((member) => member.primary.label === label);
    if (!same) continue;
    const used = round1(members.reduce((sum, member) => sum + member.primary.used, 0));
    pools.push({
      key,
      provider: members[0]!.provider,
      providerName: members[0]!.providerName,
      plan: members[0]!.plan,
      limitLabel: label,
      members: members.map((member) => ({
        id: member.id,
        name: member.name,
        used: member.primary.used,
      })),
      capacity: members.length * 100,
      used,
    });
  }
  const byProvider = new Map<Provider, AccountStory[]>();
  for (const account of accounts)
    byProvider.set(account.provider, [...(byProvider.get(account.provider) ?? []), account]);
  const unpooled: Unpooled[] = [];
  for (const [provider, members] of byProvider) {
    if (members.length < 2 || pools.some((pool) => pool.provider === provider)) continue;
    const plans = members.map((member) => member.plan ?? "Unknown plan").join(" and ");
    unpooled.push({
      provider,
      providerName: providerName(provider),
      reason: `${plans} limits differ in size, so they are not added together.`,
    });
  }

  const heat = Array.from(
    { length: 168 },
    (_, index) =>
      accounts.reduce((sum, account) => sum + (account.heat[index] ?? 0), 0) /
      Math.max(1, accounts.length),
  );

  const hits: LimitHit[] = accounts
    .flatMap((account) =>
      // Main limits only, so the list agrees with Time at Limit and Plan Fit.
      [account.primary].flatMap((limit) =>
        limit.past
          .filter((entry) => entry.limitHitAt !== null)
          .map((entry) => ({
            key: entry.key,
            accountId: account.id,
            provider: account.provider,
            account: account.name,
            limit: limit.short,
            at: entry.limitHitAt ?? entry.end,
            hoursAtLimit: entry.hoursAtLimit,
            ended: entry.ended,
          })),
      ),
    )
    .toSorted((a, b) => b.at - a.at);

  const previousPeaks = primaries
    .map((limit) => limit.previousAveragePeak)
    .filter((p): p is number => p !== null);
  const previousAveragePeak =
    previousPeaks.length === 0
      ? null
      : round1(previousPeaks.reduce((s, p) => s + p, 0) / previousPeaks.length);

  // Each local day of the range, with the hours each account's main limit sat at 100 % that day.
  const firstDay = new Date(now - (rangeDays - 1) * day);
  firstDay.setHours(0, 0, 0, 0);
  const days: DayStory[] = [];
  for (const date = firstDay; date.getTime() <= now; date.setDate(date.getDate() + 1)) {
    const from = date.getTime();
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    const to = next.getTime();
    const atLimit = accounts.flatMap((account) => {
      const overlap = account.primary.past.reduce((sum, entry) => {
        if (entry.limitHitAt === null) return sum;
        return sum + Math.max(0, Math.min(to, entry.end) - Math.max(from, entry.limitHitAt));
      }, 0);
      return overlap < hour / 2
        ? []
        : [
            {
              id: account.id,
              provider: account.provider,
              name: account.name,
              plan: account.plan,
              limit: account.primary.short,
              hours: Math.round(overlap / hour),
            },
          ];
    });
    days.push({ start: from, atLimit });
  }

  const runningOut = accounts
    .filter((account) => !account.inactive && account.primary.runsOutAt !== null)
    .toSorted((a, b) => (a.primary.runsOutAt ?? 0) - (b.primary.runsOutAt ?? 0));

  return {
    rangeDays,
    accounts,
    moneyOnly,
    averagePeak,
    averageUnused: averagePeak === null ? null : round1(100 - averagePeak),
    hoursAtLimit: round1(primaries.reduce((sum, limit) => sum + limit.hoursAtLimit, 0)),
    previousAveragePeak,
    previousHoursAtLimit: round1(
      primaries.reduce((sum, limit) => sum + limit.previousHoursAtLimit, 0),
    ),
    accountsAtLimit: primaries.filter((limit) => limit.hoursAtLimit > 0).length,
    runningOut,
    windowsClosed: primaries.reduce((sum, limit) => sum + limit.past.length, 0),
    pools,
    unpooled,
    heat,
    days,
    hits,
    readingCount: accounts.reduce(
      (sum, a) => sum + a.limits.reduce((s, l) => s + l.readingCount, 0),
      0,
    ),
    missedReadings: accounts.reduce(
      (sum, a) => sum + a.limits.reduce((s, l) => s + l.missedReadings, 0),
      0,
    ),
  };
}
