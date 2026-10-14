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

/** Hourly readings rising linearly from `from` percent to `to` percent between two instants. */
function rise(a: number, b: number, from: number, to: number): [number, number][] {
  const points: [number, number][] = [];
  for (let at = a; at < b; at += hour) points.push([at, from + ((to - from) * (at - a)) / (b - a)]);
  return points;
}

describe("weekly windows with no stored start", () => {
  const T = Date.UTC(2026, 8, 1);

  test("an early reset keeps the readings after it in the next window", () => {
    const R = T - 3 * day; // reset early, inside the window scheduled to end at T
    const E2 = R + 7 * day;
    const E3 = E2 + 7 * day;
    const E4 = E3 + 7 * day;
    const now = E4 - 2 * day;
    const { account, history } = setup({
      scope: "window:604800s",
      key: "weekly",
      used: 40,
      resetsAt: E4,
      points: [
        ...rise(T - 7 * day, R, 0, 100),
        ...rise(R, E2, 0, 80),
        ...rise(E2, E3, 0, 50),
        ...rise(E3, now, 0, 40),
      ],
      windows: [T, E2, E3, E4].map((end) => ({ start: null, end })),
    });
    const limit = buildAnalytics([account], history, now, 90, new Map()).accounts[0]?.primary;
    const second = [...(limit?.past ?? []), ...(limit?.fragments ?? [])].find(
      (item) => item.end === E2,
    );
    expect(second?.start).toBe(R);
    expect(second?.peak).toBeGreaterThan(70);
  });

  test("an offline gap does not stretch a window over the missing weeks", () => {
    const E1 = T;
    const E4 = E1 + 21 * day; // two weekly resets passed while offline
    const now = E4 + 3 * day;
    const { account, history } = setup({
      scope: "window:604800s",
      key: "weekly",
      used: 10,
      resetsAt: E4 + 7 * day,
      points: [
        ...rise(E1 - 7 * day, E1, 0, 60),
        ...rise(E4 - 7 * day, E4, 0, 70),
        ...rise(E4, now, 0, 10),
      ],
      windows: [E1, E4].map((end) => ({ start: null, end })),
    });
    const limit = buildAnalytics([account], history, now, 90, new Map()).accounts[0]?.primary;
    const last = [...(limit?.past ?? []), ...(limit?.fragments ?? [])].find(
      (item) => item.end === E4,
    );
    expect(last?.start).toBe(E4 - 7 * day);
  });

  test("a reset day that moves keeps each window's own readings", () => {
    const E1 = T;
    const E2 = E1 + 4 * day; // the provider moved its weekly reset three days earlier
    const E3 = E2 + 7 * day;
    const now = E3 - 2 * day;
    const { account, history } = setup({
      scope: "window:604800s",
      key: "weekly",
      used: 30,
      resetsAt: E3,
      points: [...rise(E1 - 7 * day, E1, 0, 90), ...rise(E1, E2, 0, 40), ...rise(E2, now, 0, 30)],
      windows: [E1, E2, E3].map((end) => ({ start: null, end })),
    });
    const limit = buildAnalytics([account], history, now, 90, new Map()).accounts[0]?.primary;
    const windows = [...(limit?.past ?? []), ...(limit?.fragments ?? [])];
    const first = windows.find((item) => item.start === E1 - 7 * day);
    const second = windows.find((item) => item.start === E1);
    expect(first?.ended).toBe("on_schedule");
    expect(first?.peak).toBeGreaterThan(85);
    expect(second?.end).toBe(E2);
    expect(second?.peak).toBeLessThan(45);
  });
});

/** Weekday 09:00-17:00 local use, one point per local hour, for `days` days before `now`. */
function office(days: number) {
  const now = Date.now();
  const shift = -new Date(now).getTimezoneOffset() * 60_000;
  const end = Math.floor((now + shift) / hour) * hour - shift;
  const first = end - days * day;
  const points: [number, number][] = [];
  let used = 0;
  for (let at = first; at < end; at += hour) {
    const local = new Date(at);
    points.push([at, used]);
    if (local.getDay() % 6 !== 0 && local.getHours() >= 9 && local.getHours() < 17) used += 1;
  }
  const metric = percent("weekly", 0, { scope: "window:604800s", resetsAt: end + day });
  const account = connection("claude", { metrics: [metric] });
  const history: History = {
    from: 0,
    to: 0,
    bucketMs: hour,
    retentionDays: 90,
    connections: [
      {
        id: account.id,
        coverage: { firstAt: first, lastAt: null, readings: points.length },
        series: [
          {
            providerMetricKey: "weekly",
            scope: "window:604800s",
            points,
            windows: [{ start: first, end: end + day }],
          },
        ],
        failures: [],
        events: [],
      },
    ],
  };
  return { account, history, end };
}

describe("hourly slots and working hours", () => {
  test("slots start on local hours", () => {
    const { account, history, end } = office(20);
    const series = buildSeries(buildAnalytics([account], history, end, 90, new Map()), end);
    const offset = new Date(series.from).getTimezoneOffset() * 60_000;
    expect((series.from - offset) % hour).toBe(0);
  });

  test("a long history marks weekday office hours as working, nothing else", () => {
    const { account, history, end } = office(40);
    const series = buildSeries(buildAnalytics([account], history, end, 90, new Map()), end);
    expect(series.hasPattern).toBe(true);
    const monday = series.working.slice(0, 24).flatMap((on, h) => (on ? [h] : []));
    expect(monday).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(series.working.slice(5 * 24).some(Boolean)).toBe(false);
  });

  test("ten days of history is no pattern: the default weekday hours apply, weekends are not working", () => {
    const { account, history, end } = office(10);
    const series = buildSeries(buildAnalytics([account], history, end, 90, new Map()), end);
    expect(series.hasPattern).toBe(false);
    expect(series.working.slice(5 * 24).some(Boolean)).toBe(false);
    expect(series.working[3]).toBe(false);
    expect(series.working[10]).toBe(true);
  });
});
