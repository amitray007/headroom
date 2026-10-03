import { describe, expect, test } from "bun:test";

import {
  addDays,
  dayLabel,
  isoDate,
  localDay,
  monthLabel,
  monthLong,
  monthName,
  parseDay,
  rollForward,
  shiftMonth,
} from "./wallet-dates.ts";

describe("days", () => {
  test("parses real dates only", () => {
    expect(parseDay("2026-10-12")).toEqual({ year: 2026, month: 10, day: 12 });
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("soon")).toBeNull();
  });

  test("a day reads as month and date", () => {
    expect(dayLabel("2026-10-12")).toBe("Oct 12");
    expect(dayLabel("2026-01-05")).toBe("Jan 5");
    expect(dayLabel("soon")).toBe("soon");
  });

  test("a month reads with its year", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(monthLabel("later")).toBe("later");
  });

  test("a moment is its UTC or its local day", () => {
    expect(isoDate(Date.UTC(2026, 9, 3, 23, 30))).toBe("2026-10-03");
    expect(localDay(new Date(2026, 9, 3, 23, 30).getTime())).toBe("2026-10-03");
    expect(localDay(new Date(2026, 0, 9, 0, 5).getTime())).toBe("2026-01-09");
  });
});

describe("rollForward", () => {
  test("rolls a monthly date to the first one on or after today", () => {
    expect(rollForward("2026-09-20", "monthly", "2026-10-03")).toBe("2026-10-20");
    expect(rollForward("2026-01-31", "monthly", "2026-02-10")).toBe("2026-02-28");
    expect(rollForward("2026-11-30", "monthly", "2026-12-31")).toBe("2027-01-30");
  });

  test("rolls an annual date by years and keeps a future one", () => {
    expect(rollForward("2025-06-01", "annual", "2026-10-03")).toBe("2027-06-01");
    expect(rollForward("2024-02-29", "annual", "2026-03-01")).toBe("2027-02-28");
    expect(rollForward("2026-12-31", "annual", "2026-10-03")).toBe("2026-12-31");
    expect(rollForward("nope", "monthly", "2026-10-03")).toBeNull();
  });
});

describe("day and month steps", () => {
  test("adds days across month and year ends", () => {
    expect(addDays("2026-10-03", 29)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("soon", 1)).toBeNull();
  });

  test("shifts months across year ends", () => {
    expect(shiftMonth("2026-10", -5)).toBe("2026-05");
    expect(shiftMonth("2026-02", -5)).toBe("2025-09");
    expect(shiftMonth("2026-11", 2)).toBe("2027-01");
    expect(shiftMonth("later", 1)).toBe("later");
  });

  test("a month reads as its short name", () => {
    expect(monthName("2026-05")).toBe("May");
    expect(monthName("2026-10")).toBe("Oct");
    expect(monthName("later")).toBe("later");
    expect(monthLong("2026-10")).toBe("October");
    expect(monthLong("later")).toBe("later");
  });
});
