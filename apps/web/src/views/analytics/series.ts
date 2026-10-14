import { providerName } from "@headroom/view-model/labels";

import type { AccountStory, Analytics, Reading } from "./model.ts";

/**
 * Hour-by-hour series for the Analytics cards, derived from the stored history in model.ts.
 *
 * Units: a slot is one hour. `hourly` holds percentage points of that account's own limit; values from different
 * accounts are never added. Combined measures count accounts instead. An unknown hour is null, never zero.
 */

const hour = 3_600_000;
const day = 24 * hour;

/** The rhythm and the actions read the last 30 days. */
export const slotCount = 30 * 24;

/** One window of an account's main limit, as it filled hour by hour. */
interface Curve {
  readonly key: string;
  readonly start: number;
  /** The reset, or when a reset credit ended the window early. */
  readonly end: number;
  readonly peak: number;
  /** When it reached 100 %, if it did. */
  readonly hitAt: number | null;
  /** When the lock ended: the reset, or the early reset. Null when it never reached 100 %. */
  readonly lockEnd: number | null;
  readonly early: boolean;
  /** The window still running; its `end` is the coming reset. */
  readonly current: boolean;
  readonly readings: readonly Reading[];
}

export interface AccountSeries {
  readonly id: string;
  readonly story: AccountStory;
  /** Unique on the page: "Claude Max", "Claude Pro (side project)", "Cursor (personal 2)". */
  readonly label: string;
  /** Oldest first, the current window last. Covers the whole fetched range, up to 90 days. */
  readonly curves: readonly Curve[];
  /** Percentage points of this account's limit used in each slot; null when no reading covers it. */
  readonly hourly: readonly (number | null)[];
  readonly locked: readonly boolean[];
  /** Points an hour that would use the limit exactly by its reset. */
  readonly evenHour: number;
}

/** A time a main limit reached 100 %, and when it opened again. */
interface Runout {
  readonly accountId: string;
  readonly at: number;
  readonly until: number;
}

export interface Series {
  /** Start of slot 0, on the hour. */
  readonly from: number;
  readonly now: number;
  readonly accounts: readonly AccountSeries[];
  /** Accounts active in each slot. A count, never a sum of percentages. */
  readonly active: readonly number[];
  /** Accounts locked at their main limit in each slot. */
  readonly locked: readonly number[];
  /** Run-outs inside the 30 days, oldest first. */
  readonly runouts: readonly Runout[];
  /** For each hour of the week (Monday 00:00 is 0), whether the owner usually works then. */
  readonly working: readonly boolean[];
}

/** Monday 00:00 is 0, Sunday 23:00 is 167, in local time. */
export function hourOfWeek(at: number): number {
  const date = new Date(at);
  return ((date.getDay() + 6) % 7) * 24 + date.getHours();
}

/** An account is active in a slot when it used at least an even hour's share: as fast as the limit renews. */
function isActive(account: AccountSeries, slot: number): boolean {
  const value = account.hourly[slot];
  return value !== null && value !== undefined && value >= account.evenHour;
}

/** Used percent of the main limit at an instant, from the window that holds it. Null when unknown. */
export function usedAt(account: AccountSeries, at: number): number | null {
  const curve = account.curves.find((entry) => at >= entry.start && at < entry.end);
  if (curve === undefined) return null;
  let last: number | null = null;
  for (const reading of curve.readings) {
    if (reading.at > at) break;
    last = reading.used;
  }
  return last;
}

// A plan that already names its product stands alone: "SuperGrok", "Google AI Pro".
function baseLabel(story: AccountStory): string {
  if (story.plan === null) return story.providerName;
  const standalone = story.plan.includes(story.providerName) || story.plan.split(" ").length >= 3;
  return standalone ? story.plan : `${story.providerName} ${story.plan}`;
}

const countOf = (list: readonly string[], value: string): number =>
  list.filter((entry) => entry === value).length;

/** Page-unique labels: the plan when it tells accounts apart, then the account name, then a number. */
function labelsOf(stories: readonly AccountStory[]): Map<string, string> {
  const base = baseLabel;
  const count = countOf;
  const plain = stories.map(base);
  const named = stories.map((story, index) => {
    const label = plain[index] ?? base(story);
    return count(plain, label) > 1 ? `${label} (${story.name.toLowerCase()})` : label;
  });
  const labels = new Map<string, string>();
  stories.forEach((story, index) => {
    const label = named[index] ?? base(story);
    const before = named.slice(0, index).filter((entry) => entry === label).length;
    labels.set(story.id, before === 0 ? label : label.replace(/\)$/, ` ${before + 1})`));
  });
  return labels;
}

function curvesOf(story: AccountStory, now: number): Curve[] {
  const limit = story.primary;
  const closed: Curve[] = [...limit.past, ...limit.fragments]
    .toSorted((a, b) => a.start - b.start)
    .map((window) => ({
      key: window.key,
      start: window.start,
      end: window.end,
      peak: window.peak,
      hitAt: window.limitHitAt,
      lockEnd: window.limitHitAt === null ? null : window.end,
      early: window.ended === "reset_early",
      current: false,
      readings: window.curve,
    }));
  // A lock still in progress runs from the hour the limit reached 100 % to now; it is not an ended window.
  const hitAt = limit.readings.find((reading) => (reading.used ?? 0) >= 100)?.at ?? null;
  const locked = limit.used >= 100;
  const current: Curve = {
    key: `${limit.key}:current`,
    start: limit.start,
    end: limit.end,
    peak: limit.used,
    hitAt: locked ? (hitAt ?? Math.min(now, limit.end)) : null,
    lockEnd: locked ? Math.min(now, limit.end) : null,
    early: false,
    current: true,
    readings: limit.readings,
  };
  return [...closed, current];
}

/** Spread each rise between two readings over the slots it covers. A gap between readings stays unknown. */
function hourlyOf(curves: readonly Curve[], from: number): (number | null)[] {
  const values = Array.from({ length: slotCount }, () => 0);
  const seen = Array.from({ length: slotCount }, () => false);
  for (const curve of curves) {
    for (let index = 1; index < curve.readings.length; index += 1) {
      const a = curve.readings[index - 1];
      const b = curve.readings[index];
      if (a === undefined || b === undefined || b.at <= a.at) continue;
      if (a.used === null || b.used === null) continue;
      const rise = Math.max(0, b.used - a.used);
      for (let at = a.at; at < b.at;) {
        const slot = Math.floor((at - from) / hour);
        const next = Math.min(b.at, from + (slot + 1) * hour);
        if (slot >= 0 && slot < slotCount) {
          values[slot] = (values[slot] ?? 0) + (rise * (next - at)) / (b.at - a.at);
          seen[slot] = true;
        }
        at = next;
      }
    }
  }
  return values.map((value, slot) => (seen[slot] === true ? value : null));
}

function lockedOf(curves: readonly Curve[], from: number): boolean[] {
  const locked = Array.from({ length: slotCount }, () => false);
  for (const curve of curves) {
    if (curve.hitAt === null || curve.lockEnd === null) continue;
    const first = Math.max(0, Math.floor((curve.hitAt - from) / hour));
    const last = Math.min(slotCount, Math.ceil((curve.lockEnd - from) / hour));
    for (let slot = first; slot < last; slot += 1) locked[slot] = true;
  }
  return locked;
}

/** Build the hourly series for the last 30 days from the Analytics model. */
export function buildSeries(analytics: Analytics, now: number): Series {
  const from = Math.floor((now - 30 * day) / hour) * hour;
  const labels = labelsOf(analytics.accounts);
  const accounts: AccountSeries[] = analytics.accounts.map((story) => {
    const curves = curvesOf(story, now);
    const length = story.primary.end - story.primary.start;
    return {
      id: story.id,
      story,
      label: labels.get(story.id) ?? providerName(story.provider),
      curves,
      hourly: hourlyOf(curves, from),
      locked: lockedOf(curves, from),
      evenHour: 100 / Math.max(1, length / hour),
    };
  });
  const active = Array.from(
    { length: slotCount },
    (_, slot) => accounts.filter((account) => isActive(account, slot)).length,
  );
  const locked = Array.from(
    { length: slotCount },
    (_, slot) => accounts.filter((account) => account.locked[slot] === true).length,
  );
  const runouts = accounts
    .flatMap((account) =>
      account.curves
        .filter((curve) => curve.hitAt !== null && curve.hitAt >= from && curve.hitAt <= now)
        .map((curve) => ({
          accountId: account.id,
          at: curve.hitAt ?? curve.end,
          until: curve.lockEnd ?? curve.end,
        })),
    )
    .toSorted((a, b) => a.at - b.at);

  // Usual working hours: hours of the week when, on average, about a third of the accounts are active.
  const sums = Array.from({ length: 168 }, () => 0);
  const counts = Array.from({ length: 168 }, () => 0);
  for (let slot = 0; slot < slotCount; slot += 1) {
    const index = hourOfWeek(from + slot * hour);
    sums[index] = (sums[index] ?? 0) + (active[slot] ?? 0);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const threshold = Math.max(1, Math.round(accounts.length * 0.35));
  const usual = sums.map((sum, index) => sum / Math.max(1, counts[index] ?? 1) >= threshold);
  // With no clear pattern every hour counts as working, so a lock in any hour still counts as blocked work.
  const working = usual.some(Boolean) ? usual : usual.map(() => true);

  return { from, now, accounts, active, locked, runouts, working };
}
