import { describe, expect, test } from "bun:test";

import { buildAnalytics } from "@headroom/view-model/analytics";
import type { History } from "@headroom/view-model/history";
import {
  accountWithHistory,
  connection,
  full,
  percent,
  ramp,
} from "@headroom/view-model/test-fixtures";

import { buildSeries, narrowSeries } from "./series.ts";

const hour = 3_600_000;
const day = 24 * hour;

describe("a current window whose reset has passed", () => {
  test("is not locked, or running out, past its end", () => {
    const now = Date.UTC(2026, 9, 20, 12);
    const end = now - 2 * day;
    const start = end - 7 * day;
    const { account, history } = accountWithHistory({
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
    const { account, history } = accountWithHistory({
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

describe("one account in view", () => {
  test("counts and run-outs cover that account, working hours stay the owner's", () => {
    const now = Date.UTC(2026, 9, 20, 12);
    const start = now - 3 * day;
    const make = (id: string) =>
      accountWithHistory({
        id,
        scope: "window:604800s",
        key: "weekly",
        used: 100,
        resetsAt: now + 4 * day,
        points: [...ramp(start, now - day, 100), ...full(now - day, now)],
        windows: [{ start, end: now + 4 * day }],
      });
    const one = make("one");
    const two = make("two");
    const history: History = {
      ...one.history,
      connections: [...one.history.connections, ...two.history.connections],
    };
    const series = buildSeries(
      buildAnalytics([one.account, two.account], history, now, 90, new Map()),
      now,
    );
    expect(Math.max(...series.locked)).toBe(2);
    const narrow = narrowSeries(series, "one");
    expect(narrow.accounts.map((account) => account.id)).toEqual(["one"]);
    expect(Math.max(...narrow.active)).toBe(1);
    expect(Math.max(...narrow.locked)).toBe(1);
    expect(narrow.runouts.every((runout) => runout.accountId === "one")).toBe(true);
    expect(narrow.working).toBe(series.working);
    expect(narrowSeries(series, null)).toBe(series);
    expect(narrowSeries(series, "gone")).toBe(series);
  });
});
