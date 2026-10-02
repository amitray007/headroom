import { describe, expect, test } from "bun:test";

import { age, countdown, exact, exactFull, resolveWhen, shortDate } from "./time.ts";

// Local components keep the tests independent of the machine's time zone.
// Thursday, October 2, 2025, 14:14 local time.
const now = new Date(2025, 9, 2, 14, 14).getTime();
const min = 60_000;
const hour = 60 * min;
const day = 24 * hour;

describe("countdown", () => {
  test.each([
    [30_000, "Under 1 min"],
    [-5 * min, "Under 1 min"],
    [52 * min, "52 min"],
    [72 * min, "1 h 12 min"],
    [3 * hour, "3 h"],
    [190 * min, "3 h 10 min"],
    [24 * hour, "1 day"],
    [30 * hour, "1 day 6 h"],
    [64 * hour, "2 days 16 h"],
    [5 * day + 18 * hour, "5 days 18 h"],
    [6 * day + 23 * hour + 59 * min, "6 days 23 h"],
    [7 * day, "7 days"],
    [12 * day, "12 days"],
    [29 * day + 20 * hour, "29 days"],
  ])("%d ms ahead reads %s", (ahead, text) => {
    expect(countdown(now + ahead, now)).toBe(text);
  });
});

describe("age", () => {
  test.each([
    [20_000, "Just now"],
    [-min, "Just now"],
    [12 * min, "12 min ago"],
    [3 * hour, "3 h ago"],
    [3 * hour + 5 * min, "3 h 5 min ago"],
    [29 * hour, "1 day 5 h ago"],
    [53 * hour, "2 days 5 h ago"],
    [2 * day, "2 days ago"],
    [8 * day + 3 * hour, "8 days ago"],
  ])("%d ms back reads %s", (back, text) => {
    expect(age(now - back, now)).toBe(text);
  });
});

describe("exact", () => {
  const today = new Date(2025, 9, 2, 15, 6).getTime();
  const later = new Date(2025, 9, 8, 8, 14).getTime();
  test("today is the time alone", () => {
    expect(exact(today, now, "24h")).toBe("15:06");
    expect(exact(today, now, "12h")).toBe("3:06 PM");
  });
  test("another day adds weekday and date", () => {
    expect(exact(later, now, "24h")).toBe("Wed, Oct 8 · 08:14");
    expect(exact(later, now, "12h")).toBe("Wed, Oct 8 · 8:14 AM");
  });
  test("twelve-hour edges", () => {
    expect(exact(new Date(2025, 9, 2, 0, 5).getTime(), now, "12h")).toBe("12:05 AM");
    expect(exact(new Date(2025, 9, 2, 12, 0).getTime(), now, "12h")).toBe("12:00 PM");
  });
  test("a time before midnight is still the same day", () => {
    expect(exact(new Date(2025, 9, 2, 23, 59).getTime(), now, "24h")).toBe("23:59");
    expect(exact(new Date(2025, 9, 3, 0, 1).getTime(), now, "24h")).toBe("Fri, Oct 3 · 00:01");
  });
  test("full form labels today", () => {
    expect(exactFull(today, now, "24h")).toBe("Today · 15:06");
    expect(exactFull(today, now, "12h")).toBe("Today · 3:06 PM");
    expect(exactFull(later, now, "24h")).toBe("Wed, Oct 8 · 08:14");
  });
  test("short date", () => {
    expect(shortDate(new Date(2025, 9, 5, 6, 25).getTime())).toBe("Oct 5");
  });
});

describe("resolveWhen", () => {
  const countdownStyle = { timeStyle: "countdown", clock: "24h" } as const;
  const exactStyle = { timeStyle: "exact", clock: "24h" } as const;
  const soon = new Date(2025, 9, 2, 15, 6).getTime();
  const later = new Date(2025, 9, 8, 8, 14).getTime();

  test("countdown shows the duration and titles the exact time", () => {
    expect(resolveWhen("until", soon, now, countdownStyle)).toEqual({
      lead: "in",
      text: "52 min",
      title: "Today · 15:06",
    });
  });
  test("countdown under one minute reads as part of a sentence", () => {
    const resolved = resolveWhen("until", now + 10_000, now, countdownStyle);
    expect(`Resets ${resolved.lead} ${resolved.text}`).toBe("Resets in under 1 min");
  });
  test("exact until, today, reads at the time", () => {
    expect(resolveWhen("until", soon, now, exactStyle)).toEqual({
      lead: "",
      text: "at 15:06",
      title: "52 min",
    });
  });
  test("exact until, another day, reads the day", () => {
    expect(resolveWhen("until", later, now, { timeStyle: "exact", clock: "12h" })).toEqual({
      lead: "",
      text: "Wed, Oct 8 · 8:14 AM",
      title: "5 days 18 h",
    });
  });
  test("ago in both styles", () => {
    const past = now - 12 * min;
    expect(resolveWhen("ago", past, now, countdownStyle)).toEqual({
      lead: "",
      text: "12 min ago",
      title: "Today · 14:02",
    });
    expect(resolveWhen("ago", past, now, exactStyle)).toEqual({
      lead: "",
      text: "14:02",
      title: "12 min ago",
    });
  });
});
