import { describe, expect, test } from "bun:test";

import { type PaceReading, paceOf } from "./pace.ts";

const hour = 3_600_000;
const t0 = 1_800_000_000_000;
const reset = t0 + 5 * 24 * hour;

/** Hourly readings from hour `from` to hour `to`, used percent given by `used(hour)`. */
function trail(
  from: number,
  to: number,
  used: (h: number) => number,
  resetsAt: number | null = reset,
): PaceReading[] {
  const out: PaceReading[] = [];
  for (let h = from; h <= to; h++) out.push({ at: t0 + h * hour, used: used(h), resetsAt });
  return out;
}

describe("paceOf", () => {
  test("a steady burn gives points per hour over the trail", () => {
    // 20 hourly readings, 10% at hour 0 to 29% at hour 19: 19 points over 19 hours.
    const pace = paceOf(trail(0, 19, (h) => 10 + h));
    expect(pace).toEqual({ ratePerHour: 1, from: t0, to: t0 + 19 * hour });
  });

  test("a fractional rate is gain over span", () => {
    // 10% at hour 0 to 20% at hour 20 in steps of 0.5: 10 points over 20 hours.
    expect(paceOf(trail(0, 20, (h) => 10 + h / 2))?.ratePerHour).toBeCloseTo(0.5, 10);
  });

  test("fewer than 4 readings is unknown", () => {
    const readings = [0, 10, 20].map((h) => ({ at: t0 + h * hour, used: 10 + h, resetsAt: reset }));
    expect(paceOf(readings)).toBeNull();
  });

  test("a span under 18 hours is unknown", () => {
    expect(paceOf(trail(0, 17, (h) => 10 + h))).toBeNull();
  });

  test("a span of exactly 18 hours is enough", () => {
    expect(paceOf(trail(0, 18, (h) => 10 + h))?.ratePerHour).toBe(1);
  });

  test("a gain under 2 points is unknown", () => {
    expect(paceOf(trail(0, 20, (h) => (h >= 10 ? 11.5 : 10)))).toBeNull();
  });

  test("an idle last 6 hours is unknown", () => {
    // Gained 10 points by hour 12, then flat to hour 20.
    expect(paceOf(trail(0, 20, (h) => 10 + Math.min(h, 12)))).toBeNull();
  });

  test("a reset inside the trail ignores the old period", () => {
    const oldReset = t0 + 3 * hour;
    const before = trail(0, 4, (h) => 90 + h, oldReset);
    const after = trail(5, 26, (h) => 2 + (h - 5)); // 21 points over 21 hours
    const pace = paceOf([...before, ...after]);
    expect(pace).toEqual({ ratePerHour: 1, from: t0 + 5 * hour, to: t0 + 26 * hour });
  });

  test("an early reset drop mid-trail cuts the trail at the drop", () => {
    // Climbs to 40 at hour 10, drops to 5 at hour 11, then 1 point per hour to hour 30.
    const readings = trail(0, 30, (h) => (h <= 10 ? 30 + h : 5 + (h - 11)));
    const pace = paceOf(readings);
    expect(pace).toEqual({ ratePerHour: 1, from: t0 + 11 * hour, to: t0 + 30 * hour });
  });

  test("a drop of 1 point or less is rounding noise and does not cut", () => {
    const readings = trail(0, 20, (h) => (h === 10 ? 19.5 : 10 + h));
    expect(paceOf(readings)?.from).toBe(t0);
  });

  test("a reset time sliding 15 minutes per reading is unknown", () => {
    const readings: PaceReading[] = [];
    for (let i = 0; i <= 90; i++) {
      const at = t0 + i * 15 * 60_000;
      readings.push({ at, used: 10 + i / 4, resetsAt: at + 7 * 24 * hour });
    }
    expect(paceOf(readings)).toBeNull();
  });

  test("a null reset on the newest reading is unknown", () => {
    const readings = trail(0, 20, (h) => 10 + h);
    readings[readings.length - 1] = { at: t0 + 20 * hour, used: 30, resetsAt: null };
    expect(paceOf(readings)).toBeNull();
  });

  test("a reset time not after the newest reading is unknown", () => {
    expect(paceOf(trail(0, 20, (h) => 10 + h, t0 + 20 * hour))).toBeNull();
  });

  test("a null reset in the trail drops the readings up to it", () => {
    const readings = trail(0, 20, (h) => 10 + h);
    readings[5] = { at: t0 + 5 * hour, used: 15, resetsAt: null };
    // Only hours 6 to 20 remain: 14 hours, under the 18-hour span.
    expect(paceOf(readings)).toBeNull();
  });

  test("reset times within 10 minutes count as one window", () => {
    const readings = trail(0, 20, (h) => 10 + h, null).map((r, i) => ({
      at: r.at,
      used: r.used,
      resetsAt: reset + (i % 2) * 8 * 60_000,
    }));
    expect(paceOf(readings)?.from).toBe(t0);
  });

  test("readings older than 24 hours are ignored", () => {
    // Hours 0 to 4 are older than 24 hours before the anchor at hour 30. Hours 6 to 30 climb at 1 per hour.
    const readings = [...trail(0, 4, (h) => 50 + h * 10), ...trail(6, 30, (h) => h)];
    const pace = paceOf(readings);
    expect(pace).toEqual({ ratePerHour: 1, from: t0 + 6 * hour, to: t0 + 30 * hour });
  });

  test("unsorted input gives the same answer", () => {
    const sorted = trail(0, 19, (h) => 10 + h);
    const shuffled = [...sorted.slice(10), ...sorted.slice(0, 10)].toReversed();
    expect(paceOf(shuffled)).toEqual(paceOf(sorted));
    expect(paceOf(shuffled)?.ratePerHour).toBe(1);
  });

  test("no readings is unknown", () => {
    expect(paceOf([])).toBeNull();
  });
});
