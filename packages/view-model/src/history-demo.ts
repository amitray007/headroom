import type { AccountEvent, SyncRunOutcome } from "@headroom/core/contracts";

import { meterWindows, type MeterWindow } from "./accounts.ts";
import type {
  History,
  HistoryConnection,
  HistoryPoint,
  HistorySeries,
  HistoryWindow,
} from "./history.ts";
import type { OverviewConnection } from "./overview.ts";

/**
 * MOCKUP / DEMO ONLY. Made-up usage history for Demo Mode, in the shape `GET /api/history` returns, so every
 * current value matches the demo overview. Real history comes from stored readings; nothing here is provider data.
 * Same seed, connections and anchor give the same history.
 *
 * Units: `used` is percent of one limit window (0..100) and is never added across accounts. Instants are
 * milliseconds. An hour with no reading is absent, not zero.
 */

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** How long the demo pretends the server keeps history. */
const retentionDays = 90;

/** mulberry32: a small seeded generator, so the demo reads the same on every load. */
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
// Buckets start at local hours, as the server's do when the page sends its offset. Only the part of the offset
// below a whole hour matters: it moves the grid in half-hour and 45-minute zones.
const localShift = (at: number): number =>
  (((-new Date(at).getTimezoneOffset() * minute) % hour) + hour) % hour;
const hourOf = (at: number): number =>
  Math.floor((at + localShift(at)) / hour) * hour - localShift(at);
const ceilHour = (at: number): number => {
  const floor = hourOf(at);
  return floor === at ? at : floor + hour;
};

interface Profile {
  readonly night: number;
  readonly weekend: number;
}

/** Weight of one hour of the week for an account: weekday work hours, a lighter evening, quieter weekends. */
function hourWeight(at: number, profile: Profile): number {
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
 * How full past windows ran, by provider and plan. Without an entry, past windows follow the current pace.
 * These give the demo a mix of plans that are too small, about right and too big.
 */
const appetiteByPlan: Record<string, number> = {
  "codex:pro": 62,
  "grok:supergrok heavy": 30,
};

interface Made {
  readonly series: HistorySeries;
  readonly events: AccountEvent[];
}

/** One limit of one connection: the current window ending at the reported value, and the windows before it. */
function makeSeries(
  connection: OverviewConnection,
  window: MeterWindow,
  anchor: number,
  days: number,
  profile: Profile,
  seed: number,
  gaps: ReadonlySet<number>,
  canResetEarly: boolean,
): Made | null {
  if (window.unlimited || window.used === null) return null;
  if (window.kind === "other" || window.start === null || window.end === null) return null;
  const { start, end, used } = window;
  const length = end - start;
  const scope =
    connection.snapshot?.metrics.find((metric) => metric.providerMetricKey === window.key)?.scope ??
    "";
  const events: AccountEvent[] = [];

  // The current window: cumulative weight up to the anchor, scaled so the last point equals the reported value.
  const times: number[] = [];
  for (let at = ceilHour(start); at <= hourOf(anchor); at += hour) times.push(at);
  // Jitter from a keyed hash, not the shared generator: the number of points grows with time, and drawing from
  // the generator here would reshuffle every later draw.
  const jitterKey = hash(`${seed}:${connection.id}:${window.key}:now`);
  const weights = times.map(
    (at, index) => hourWeight(at, profile) * (0.6 + noise(jitterKey, index) * 0.8),
  );
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  let running = 0;
  const current: HistoryPoint[] = [];
  times.forEach((at, index) => {
    running += weights[index] ?? 0;
    const last = index === times.length - 1;
    if (!last && gaps.has(at)) return;
    current.push([at, round1(Math.min(100, (running / total) * used))]);
  });
  if (current.length > 0) current[current.length - 1] = [times.at(-1) ?? anchor, used];

  const windows: HistoryWindow[] = [{ start, end }];
  const points: HistoryPoint[] = [];
  // Session limits reset every few hours and no card reads their past, so only the current one is made.
  if (window.kind !== "session") {
    const planKey = `${connection.provider}:${(connection.plan ?? "").toLowerCase()}`;
    const curveKey = hash(`${seed}:${connection.id}:${window.key}`);
    // Keyed by the account and the limit, never by the live value, so the past does not change as time passes.
    const appetite = appetiteByPlan[planKey] ?? 18 + noise(curveKey, 7001) * 94;
    const rangeStart = anchor - days * day;
    let earlyUsed = false;
    let count = 0;
    for (let windowEnd = start; windowEnd > rangeStart; windowEnd -= length) {
      const windowStart = windowEnd - length;
      // An account that banks reset credits spent one on the window before last, so the demo shows that case.
      const forced = canResetEarly && window.kind === "weekly" && count === 1;
      count += 1;
      const raw = forced ? 108 : appetite * (0.7 + noise(curveKey, windowStart / hour) * 0.6);
      const hit = raw >= 100;
      const target = hit ? raw : Math.max(3, raw);
      const hours: number[] = [];
      for (let at = ceilHour(windowStart); at < windowEnd; at += hour) hours.push(at);
      const curveWeights = hours.map(
        (at, index) =>
          hourWeight(at, profile) * dayFactor(curveKey, at) * (0.7 + 0.6 * noise(curveKey, index)),
      );
      const curveTotal = curveWeights.reduce((sum, w) => sum + w, 0) || 1;
      let filled = 0;
      const values = curveWeights.map((w) =>
        round1(Math.min(100, ((filled += w) / curveTotal) * target)),
      );
      const crossing = hit ? values.findIndex((value) => value >= 100) : -1;
      const hitHour = crossing < 0 ? null : (hours[crossing] ?? null);
      const earlyAt =
        hitHour !== null && canResetEarly && !earlyUsed && window.kind === "weekly"
          ? hitHour + 2 * hour
          : null;
      const resetEarly = earlyAt !== null && earlyAt < windowEnd;
      if (resetEarly) earlyUsed = true;
      const stop = resetEarly ? earlyAt : windowEnd;
      const kept: HistoryPoint[] = [];
      hours.forEach((at, index) => {
        if (at < stop && !gaps.has(at)) kept.push([at, values[index] ?? 0]);
      });
      points.push(...kept);
      windows.push({ start: windowStart, end: windowEnd });
      if (resetEarly) {
        events.push({
          id: `demo-early-${connection.id}-${window.key}-${earlyAt}`,
          connectionId: connection.id,
          occurredAt: earlyAt,
          metricKey: window.key,
          detail: {
            kind: "early_reset",
            previousPercent: 100,
            percent: 0,
            expectedResetAt: windowEnd,
            bankedUsed: true,
          },
        });
        // A fresh window starts at once and runs at the account's usual pace until the old schedule's reset.
        const span = windowEnd - earlyAt;
        const rise = appetite * 0.6 * (span / length);
        const fresh: number[] = [];
        for (let at = earlyAt; at < windowEnd; at += hour) fresh.push(at);
        fresh.forEach((at, index) => {
          if (!gaps.has(at)) points.push([at, round1((rise * index) / Math.max(1, fresh.length))]);
        });
        windows.push({ start: earlyAt, end: windowEnd });
      }
    }
  }
  const ordered = [...points, ...current].toSorted((a, b) => a[0] - b[0]);
  return {
    series: {
      providerMetricKey: window.key,
      scope,
      points: ordered,
      windows: windows.toSorted((a, b) => (a.start ?? a.end) - (b.start ?? b.end)),
    },
    events,
  };
}

/** Hours with no stored reading: a few short outages, and one in the current week. */
function gapHours(key: number, anchor: number, days: number): Set<number> {
  const gaps = new Set<number>();
  const firstDay = Math.floor((anchor - (days + 8) * day) / day);
  for (let d = firstDay; d * day <= anchor; d += 1) {
    if (noise(key, d) >= 0.1) continue;
    const first = hourOf(d * day + (8 + Math.floor(noise(key, d + 500) * 8)) * hour);
    const span = 2 + Math.floor(noise(key, d + 900) * 3);
    for (let i = 0; i < span; i += 1) gaps.add(first + i * hour);
  }
  const recent = hourOf(anchor - 3 * day);
  for (let i = 0; i < 3; i += 1) gaps.add(recent + i * hour);
  gaps.delete(hourOf(anchor));
  return gaps;
}

/**
 * Made-up history for the demo connections over `days` days ending at `anchor`. Every limit with a window gets
 * hourly points whose last point is the overview's reported value. Every fourth account has missing hours and the
 * failed refreshes that explain them, and Codex accounts show one early reset.
 */
export function demoHistory(
  seed: number,
  connections: readonly OverviewConnection[],
  anchor: number,
  days: number,
): History {
  let from = anchor - days * day;
  const result: HistoryConnection[] = connections.map((connection, index) => {
    const rng = random(hash(`${seed}:${connection.id}`));
    const profile = { night: 0.2 + rng() * 0.7, weekend: 0.15 + rng() * 0.6 };
    const gappy = index % 4 === 1;
    const gaps = gappy
      ? gapHours(hash(`${seed}:${connection.id}:gaps`), anchor, days)
      : new Set<number>();
    const canResetEarly = connection.provider === "codex";
    const made = meterWindows(connection)
      .map((window) =>
        makeSeries(connection, window, anchor, days, profile, seed, gaps, canResetEarly),
      )
      .filter((entry): entry is Made => entry !== null);
    const series = made.map((entry) => entry.series);
    const times = series.flatMap((entry) => entry.points.map((point) => point[0]));
    const firstAt = times.length === 0 ? null : Math.min(...times);
    // A window that began before the range is kept whole, so the range reaches back to the oldest one.
    for (const entry of series) {
      for (const window of entry.windows) from = Math.min(from, window.start ?? window.end);
    }
    const failures: { at: number; outcome: SyncRunOutcome }[] = [...gaps]
      .filter((at) => at >= (firstAt ?? anchor) && at < anchor)
      .toSorted((a, b) => a - b)
      .map((at, position) => ({
        at: at + 30 * minute,
        outcome: position % 3 === 0 ? "rate_limited" : "provider_unavailable",
      }));
    return {
      id: connection.id,
      coverage: {
        firstAt,
        lastAt: times.length === 0 ? null : anchor,
        readings: times.length,
      },
      series,
      failures: times.length === 0 ? [] : failures,
      events: made.flatMap((entry) => entry.events).toSorted((a, b) => a.occurredAt - b.occurredAt),
    };
  });
  return { from, to: anchor, bucketMs: hour, retentionDays, connections: result };
}
