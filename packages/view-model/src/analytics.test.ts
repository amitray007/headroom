import { describe, expect, test } from "bun:test";

import {
  buildAnalytics,
  planFitOf,
  type AccountStory,
  type LimitStory,
  type PastWindow,
} from "./analytics.ts";
import { accountWithHistory, ramp, rise } from "./test-fixtures.ts";

const hour = 3_600_000;
const day = 24 * hour;

describe("monthly cycles with only a reset time", () => {
  test("30 and 31 day cycles give on-schedule windows, never a false early reset", () => {
    const sep15 = Date.UTC(2026, 8, 15);
    const oct15 = Date.UTC(2026, 9, 15);
    const nov15 = Date.UTC(2026, 10, 15);
    const dec15 = Date.UTC(2026, 11, 15);
    const now = Date.UTC(2026, 10, 20);
    const { account, history } = accountWithHistory({
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

describe("weekly windows with no stored start", () => {
  const T = Date.UTC(2026, 8, 1);

  test("an early reset keeps the readings after it in the next window", () => {
    const R = T - 3 * day; // reset early, inside the window scheduled to end at T
    const E2 = R + 7 * day;
    const E3 = E2 + 7 * day;
    const E4 = E3 + 7 * day;
    const now = E4 - 2 * day;
    const { account, history } = accountWithHistory({
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
    const { account, history } = accountWithHistory({
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
    const { account, history } = accountWithHistory({
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

const limitOf = (past: readonly PastWindow[]): LimitStory => ({
  key: "weekly",
  kind: "weekly",
  start: 0,
  end: 0,
  used: 0,
  readings: [],
  elapsedShare: 0,
  pace: null,
  projectedAtReset: null,
  runsOutAt: null,
  past,
  fragments: [],
  averagePeak: null,
});

const storyOf = (past: readonly PastWindow[], monthlyCost: number | null = null): AccountStory => ({
  id: "a",
  provider: "claude",
  providerName: "Claude",
  name: "Personal",
  plan: null,
  inactive: false,
  stale: false,
  primary: limitOf(past),
  monthlyCost,
  priceNote: "",
});

describe("planFitOf", () => {
  const now = 100 * day;
  const span = 90 * day;

  const past = (index: number, peak: number, over: Partial<PastWindow> = {}): PastWindow => ({
    key: `w${index}`,
    start: now - (index + 1) * 7 * day,
    end: now - index * 7 * day,
    peak,
    hoursAtLimit: 0,
    limitHitAt: null,
    ended: "on_schedule",
    curve: [],
    ...over,
  });

  test("no closed window in the span is no fit", () => {
    expect(planFitOf(storyOf([]), now, span)).toBeNull();
    expect(planFitOf(storyOf([past(20, 50)]), now, span)).toBeNull();
  });

  test("one window is thin, even at the limit", () => {
    const fit = planFitOf(storyOf([past(1, 100)]), now, span);
    expect(fit?.verdict).toBe("thin");
    expect(fit?.unit).toBe("week");
  });

  test("a third of windows at the limit is too small, counting hours and early resets", () => {
    const fit = planFitOf(
      storyOf([
        past(1, 100, { hoursAtLimit: 6, ended: "reset_early" }),
        past(2, 20),
        past(3, 30, { limitHitAt: now }),
      ]),
      now,
      span,
    );
    expect(fit?.verdict).toBe("too_small");
    expect(fit?.hits).toBe(2);
    expect(fit?.lockedHours).toBe(6);
    expect(fit?.highest).toBe(100);
    expect(fit?.windows.map((window) => window.early)).toEqual([true, false, false]);
  });

  test("a low average with no hits is room to spare", () => {
    const fit = planFitOf(storyOf([past(1, 40), past(2, 30), past(3, 50)]), now, span);
    expect(fit?.average).toBe(40);
    expect(fit?.verdict).toBe("room_to_spare");
  });

  test("an average of 45 or more with few hits fits", () => {
    const fit = planFitOf(
      storyOf([past(1, 45), past(2, 45), past(3, 45), past(4, 100)]),
      now,
      span,
    );
    expect(fit?.hits).toBe(1);
    expect(fit?.verdict).toBe("fits");
  });

  test("unused dollars follow the average peak, and are null without a price", () => {
    const windows = [past(1, 40), past(2, 60)];
    expect(planFitOf(storyOf(windows, 200), now, span)?.unusedUsd).toBe(100);
    expect(planFitOf(storyOf(windows, null), now, span)?.unusedUsd).toBeNull();
  });
});
