import { describe, expect, test } from "bun:test";

import {
  addDays,
  addMonths,
  clampDate,
  daysInMonth,
  endOfWeek,
  formatIso,
  formatShort,
  isOutOfRange,
  monthGrid,
  parseIso,
  sameMonth,
  startOfMonth,
  startOfWeek,
  todayIso,
  weekdayIndex,
  weekdayLabels,
} from "./calendar.ts";

describe("parseIso and formatIso", () => {
  test("round-trips a valid day", () => {
    expect(parseIso("2026-10-12")).toEqual({ year: 2026, month: 10, day: 12 });
    expect(formatIso({ year: 2026, month: 3, day: 5 })).toBe("2026-03-05");
  });

  test("rejects other shapes and days that do not exist", () => {
    expect(parseIso("2026-2-3")).toBeNull();
    expect(parseIso("Oct 12, 2026")).toBeNull();
    expect(parseIso("2026-02-30")).toBeNull();
    expect(parseIso("2026-13-01")).toBeNull();
    expect(parseIso("2025-02-29")).toBeNull();
    expect(parseIso("2024-02-29")).not.toBeNull();
  });
});

describe("daysInMonth", () => {
  test("handles leap years", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });
});

describe("addDays", () => {
  test("crosses month and year edges", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-12", 7)).toBe("2026-10-19");
  });

  test("is not moved by a daylight saving change", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  });
});

describe("addMonths", () => {
  test("keeps the day when it fits", () => {
    expect(addMonths("2026-10-12", 1)).toBe("2026-11-12");
    expect(addMonths("2026-10-12", -10)).toBe("2025-12-12");
  });

  test("clamps to the shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  test("crosses years in both directions", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-01-15", 12)).toBe("2027-01-15");
  });
});

describe("weeks start on Monday", () => {
  test("weekdayIndex", () => {
    expect(weekdayIndex("2026-10-12")).toBe(0);
    expect(weekdayIndex("2026-10-18")).toBe(6);
    expect(weekdayIndex("2026-10-04")).toBe(6);
  });

  test("startOfWeek and endOfWeek", () => {
    expect(startOfWeek("2026-10-04")).toBe("2026-09-28");
    expect(endOfWeek("2026-10-04")).toBe("2026-10-04");
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
    expect(endOfWeek("2026-10-12")).toBe("2026-10-18");
  });

  test("weekdayLabels starts at Monday", () => {
    const labels = weekdayLabels("en-US");
    expect(labels).toHaveLength(7);
    expect(labels[0]).toBe("Mon");
    expect(labels[6]).toBe("Sun");
  });
});

describe("monthGrid", () => {
  test("always has six Monday-first weeks", () => {
    for (const month of ["2026-02-10", "2026-10-04", "2024-02-01", "2026-03-31"]) {
      const grid = monthGrid(month);
      expect(grid).toHaveLength(6);
      for (const week of grid) {
        expect(week).toHaveLength(7);
        expect(weekdayIndex(week[0] ?? "")).toBe(0);
      }
    }
  });

  test("shows leading and trailing days around October 2026", () => {
    const grid = monthGrid("2026-10-15");
    // Oct 1, 2026 is a Thursday, so three leading days of September.
    expect(grid[0]?.[0]).toBe("2026-09-28");
    expect(grid[0]?.[3]).toBe("2026-10-01");
    expect(grid[4]?.[5]).toBe("2026-10-31");
    expect(grid[5]?.[6]).toBe("2026-11-08");
    expect(grid.flat().filter((day) => sameMonth(day, "2026-10-01"))).toHaveLength(31);
  });

  test("starts on the 1st when it is a Monday", () => {
    expect(monthGrid("2026-06-20")[0]?.[0]).toBe("2026-06-01");
  });

  test("covers every day in order", () => {
    const flat = monthGrid("2026-02-01").flat();
    for (let index = 1; index < flat.length; index++) {
      expect(flat[index]).toBe(addDays(flat[index - 1] ?? "", 1));
    }
  });
});

describe("clamping and range", () => {
  test("clampDate pulls a day inside the bounds", () => {
    expect(clampDate("2026-10-01", "2026-10-10", "2026-10-20")).toBe("2026-10-10");
    expect(clampDate("2026-11-01", "2026-10-10", "2026-10-20")).toBe("2026-10-20");
    expect(clampDate("2026-10-15", "2026-10-10", "2026-10-20")).toBe("2026-10-15");
    expect(clampDate("2026-10-15")).toBe("2026-10-15");
  });

  test("isOutOfRange", () => {
    expect(isOutOfRange("2026-10-09", "2026-10-10")).toBe(true);
    expect(isOutOfRange("2026-10-10", "2026-10-10")).toBe(false);
    expect(isOutOfRange("2026-10-21", undefined, "2026-10-20")).toBe(true);
    expect(isOutOfRange("2026-10-21")).toBe(false);
  });

  test("startOfMonth", () => {
    expect(startOfMonth("2026-10-12")).toBe("2026-10-01");
  });
});

describe("formatting", () => {
  test("formatShort spells the month", () => {
    expect(formatShort("2026-10-12")).toBe("Oct 12, 2026");
    expect(formatShort("2026-01-01")).toBe("Jan 1, 2026");
  });

  test("todayIso reads the local date", () => {
    expect(todayIso(new Date(2026, 9, 4, 23, 59))).toBe("2026-10-04");
    expect(todayIso(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });
});
