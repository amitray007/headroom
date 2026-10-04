import { describe, expect, test } from "bun:test";

import {
  axisFor,
  clockText,
  columnOf,
  dayClock,
  elapsedShare,
  placeSpan,
  positionOf,
  rangeLabel,
  resetShort,
} from "./range.ts";

const hour = 3_600_000;
const day = 24 * hour;
// Fri Oct 3, 2025, 11:30 local.
const now = new Date(2025, 9, 3, 11, 30).getTime();
const midnight = new Date(2025, 9, 3).getTime();

describe("axisFor", () => {
  test("weekly shows the last week and the next, from midnight", () => {
    const axis = axisFor("weekly", now, 0);
    expect(axis.base).toBe(new Date(2025, 8, 26).getTime());
    expect(axis.end).toBe(new Date(2025, 9, 10).getTime());
    expect(axis.columns).toHaveLength(14);
    expect(axis.columns[7]).toBe(new Date(2025, 9, 3).getTime());
    expect(rangeLabel(axis)).toBe("Sep 26 – Oct 9 · 14 Days");
  });
  test("a step moves the weekly range by whole weeks", () => {
    expect(axisFor("weekly", now, 1).base).toBe(new Date(2025, 9, 3).getTime());
    expect(axisFor("weekly", now, -1).base).toBe(new Date(2025, 8, 19).getTime());
  });
  test("5-hour shows 24 hours that start six hours before now on a two-hour mark", () => {
    const axis = axisFor("session", now, 0);
    expect(axis.end - axis.base).toBe(day);
    expect(axis.columns).toHaveLength(12);
    expect(now).toBeGreaterThan(axis.base + 5 * hour);
    expect(now).toBeLessThan(axis.base + 8 * hour);
    expect((axis.base - midnight) % (2 * hour)).toBe(0);
    expect(axisFor("session", now, 1).base - axis.base).toBe(day);
  });
  test("now is always on the axis at step zero", () => {
    for (const kind of ["weekly", "session", "cycle"] as const) {
      for (const clock of [0, 3, 5.9, 6, 12, 23.9]) {
        const at = midnight + clock * hour;
        const axis = axisFor(kind, at, 0);
        expect(positionOf(axis, at)).not.toBeNull();
      }
    }
  });
  test("cycle shows ten weeks and steps four weeks", () => {
    const axis = axisFor("cycle", now, 0);
    expect(axis.columns).toHaveLength(10);
    expect(axis.base).toBe(new Date(2025, 8, 5).getTime());
    expect(axisFor("cycle", now, 1).base).toBe(new Date(2025, 9, 3).getTime());
    expect(rangeLabel(axis)).toBe("Sep 5 – Nov 13 · 10 Weeks");
  });
  test("a 24-hour range inside one day shows one date", () => {
    const axis = axisFor("session", new Date(2025, 9, 3, 7, 0).getTime(), 0);
    expect(rangeLabel(axis).endsWith("· 24 Hours")).toBe(true);
  });
});

describe("placement", () => {
  const axis = axisFor("weekly", now, 0);
  test("position is a percent of the axis, null outside", () => {
    expect(positionOf(axis, axis.base)).toBe(0);
    expect(positionOf(axis, axis.base + (axis.end - axis.base) / 2)).toBe(50);
    expect(positionOf(axis, axis.base - 1)).toBeNull();
    expect(positionOf(axis, axis.end + 1)).toBeNull();
  });
  test("a span inside the axis is not cut", () => {
    const box = placeSpan(axis, axis.base + 2 * day, axis.base + 4 * day);
    expect(box?.left).toBeCloseTo(100 / 7, 5);
    expect(box?.width).toBeCloseTo(100 / 7, 5);
    expect(box?.cutStart).toBe(false);
    expect(box?.cutEnd).toBe(false);
  });
  test("a span past an edge is clipped and marked cut", () => {
    const early = placeSpan(axis, axis.base - day, axis.base + day);
    expect(early).toMatchObject({ left: 0, cutStart: true, cutEnd: false, from: axis.base });
    const late = placeSpan(axis, axis.end - day, axis.end + day);
    expect(late).toMatchObject({ cutStart: false, cutEnd: true, to: axis.end });
    expect((late?.left ?? 0) + (late?.width ?? 0)).toBeCloseTo(100, 5);
  });
  test("a span wholly outside is not placed", () => {
    expect(placeSpan(axis, axis.end, axis.end + day)).toBeNull();
    expect(placeSpan(axis, axis.base - 2 * day, axis.base)).toBeNull();
  });
  test("the column of an instant", () => {
    expect(columnOf(axis, now)).toBe(7);
    expect(columnOf(axis, axis.end)).toBeNull();
    expect(columnOf(axis, axis.base)).toBe(0);
  });
  test("elapsed share of a visible box", () => {
    const box = { from: 0, to: 100 };
    expect(elapsedShare(box, 25)).toBe(0.25);
    expect(elapsedShare(box, -5)).toBe(0);
    expect(elapsedShare(box, 500)).toBe(1);
  });
});

describe("wording", () => {
  const monday = new Date(2025, 9, 6, 19, 5).getTime();
  test("clock follows the setting", () => {
    expect(clockText(monday, "24h")).toBe("19:05");
    expect(clockText(monday, "12h")).toBe("7:05 PM");
    expect(clockText(new Date(2025, 9, 6, 0, 0).getTime(), "12h")).toBe("12:00 AM");
    expect(dayClock(monday, "24h")).toBe("Mon 19:05");
  });
  test("the reset on a bar depends on the window kind", () => {
    expect(resetShort("weekly", monday, "24h")).toBe("Mon 19:05");
    expect(resetShort("session", monday, "24h")).toBe("19:05");
    expect(resetShort("cycle", monday, "24h")).toBe("Oct 6");
  });
});
