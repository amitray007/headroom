import { describe, expect, test } from "bun:test";

import type { History } from "@headroom/view-model/history";
import { connection, percent } from "@headroom/view-model/test-fixtures";

import { buildAnalytics } from "./model.ts";
import { buildSeries } from "./series.ts";

const hour = 3_600_000;
const day = 24 * hour;

/** One synthetic account with one percent meter and the matching stored history. */
function setup(args: {
  readonly scope: string;
  readonly key: string;
  readonly used: number;
  readonly resetsAt: number;
  readonly points: [number, number][];
  readonly windows: { start: number | null; end: number }[];
}) {
  const metric = percent(args.key, args.used, { scope: args.scope, resetsAt: args.resetsAt });
  const account = connection("claude", { metrics: [metric] });
  const history: History = {
    from: 0,
    to: 0,
    bucketMs: hour,
    retentionDays: 90,
    connections: [
      {
        id: account.id,
        coverage: {
          firstAt: args.points[0]?.[0] ?? null,
          lastAt: null,
          readings: args.points.length,
        },
        series: [
          {
            providerMetricKey: args.key,
            scope: args.scope,
            points: args.points,
            windows: args.windows,
          },
        ],
        failures: [],
        events: [],
      },
    ],
  };
  return { account, history };
}

/** Hourly points rising from `from` to `peak` percent at `to`. */
function ramp(from: number, to: number, peak: number): [number, number][] {
  const points: [number, number][] = [];
  for (let at = from; at < to; at += hour) points.push([at, (peak * (at - from)) / (to - from)]);
  return points;
}

/** Hourly points held at 100 percent. */
function full(from: number, to: number): [number, number][] {
  const points: [number, number][] = [];
  for (let at = from; at < to; at += hour) points.push([at, 100]);
  return points;
}

describe("monthly cycles with only a reset time", () => {
  test("30 and 31 day cycles give on-schedule windows, never a false early reset", () => {
    const sep15 = Date.UTC(2026, 8, 15);
    const oct15 = Date.UTC(2026, 9, 15);
    const nov15 = Date.UTC(2026, 10, 15);
    const dec15 = Date.UTC(2026, 11, 15);
    const now = Date.UTC(2026, 10, 20);
    const { account, history } = setup({
      scope: "month",
      key: "cycle",
      used: 20,
      resetsAt: dec15,
      points: [
        ...ramp(Date.UTC(2026, 7, 15), sep15, 60),
        ...ramp(sep15, oct15, 60),
        ...ramp(oct15, nov15, 60),
        ...ramp(nov15, now, 20),
      ],
      windows: [
        { start: null, end: sep15 },
        { start: null, end: oct15 },
        { start: null, end: nov15 },
      ],
    });
    const analytics = buildAnalytics([account], history, now, 90, new Map());
    const limit = analytics.accounts[0]?.primary;
    expect(limit?.kind).toBe("cycle");
    const all = [...(limit?.past ?? []), ...(limit?.fragments ?? [])];
    expect(all.length).toBe(3);
    expect(all.every((item) => item.ended === "on_schedule")).toBe(true);
    expect(limit?.past.map((item) => item.start)).toEqual([Date.UTC(2026, 7, 15), sep15, oct15]);
  });
});

describe("a current window whose reset has passed", () => {
  test("is not locked, or running out, past its end", () => {
    const now = Date.UTC(2026, 9, 20, 12);
    const end = now - 2 * day;
    const start = end - 7 * day;
    const { account, history } = setup({
      scope: "window:604800s",
      key: "weekly",
      used: 100,
      resetsAt: end,
      points: [...ramp(start, end - 2 * day, 100), ...full(end - 2 * day, end)],
      windows: [{ start, end }],
    });
    const analytics = buildAnalytics([account], history, now, 90, new Map());
    const limit = analytics.accounts[0]?.primary;
    expect(limit?.runsOutAt).toBeNull();
    expect(limit?.readings.every((reading) => reading.at <= end)).toBe(true);
    const series = buildSeries(analytics, now);
    const locked = series.accounts[0]?.locked ?? [];
    const lastLocked = locked.lastIndexOf(true);
    expect(lastLocked).toBeGreaterThanOrEqual(0);
    expect(series.from + lastLocked * hour).toBeLessThan(end);
  });
});

describe("working hours", () => {
  test("one account locked in its own hours yields locked work hours", () => {
    const now = Date.UTC(2026, 9, 20, 12);
    const start = now - 3 * day;
    const { account, history } = setup({
      scope: "window:604800s",
      key: "weekly",
      used: 100,
      resetsAt: now + 4 * day,
      points: [...ramp(start, now - day, 100), ...full(now - day, now)],
      windows: [{ start, end: now + 4 * day }],
    });
    const series = buildSeries(buildAnalytics([account], history, now, 90, new Map()), now);
    expect(series.working.some(Boolean)).toBe(true);
    const slots = (series.accounts[0]?.locked ?? []).flatMap((locked, slot) =>
      locked && series.working[hourOfWeekAt(series.from + slot * hour)] === true ? [slot] : [],
    );
    expect(slots.length).toBeGreaterThan(0);
  });
});

function hourOfWeekAt(at: number): number {
  const date = new Date(at);
  return ((date.getDay() + 6) % 7) * 24 + date.getHours();
}
