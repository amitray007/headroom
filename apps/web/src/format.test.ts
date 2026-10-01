import { describe, expect, test } from "bun:test";

import { formatAge, formatMetricValue, formatTimeLeft } from "./format.ts";

describe("formatAge", () => {
  test("rounds down to the largest unit", () => {
    expect(formatAge(1000, 1000 + 30_000)).toBe("just now");
    expect(formatAge(0, 60_000)).toBe("1 minute ago");
    expect(formatAge(0, 5 * 60_000)).toBe("5 minutes ago");
    expect(formatAge(0, 3 * 3_600_000)).toBe("3 hours ago");
    expect(formatAge(0, 2 * 86_400_000)).toBe("2 days ago");
  });
});

describe("formatTimeLeft", () => {
  test("counts down and expires", () => {
    expect(formatTimeLeft(125_000, 0)).toBe("2:05");
    expect(formatTimeLeft(1000, 1000)).toBe("expired");
  });
});

describe("formatMetricValue", () => {
  const base = { availability: "available", valueText: "42.5", unit: "percent" };
  test("shows values with units", () => {
    expect(formatMetricValue(base)).toBe("42.5 percent");
  });
  test("unavailable is unknown, never zero", () => {
    expect(formatMetricValue({ ...base, availability: "not_authorized", valueText: "0" })).toBe(
      "unknown",
    );
    expect(formatMetricValue({ ...base, valueText: null })).toBe("unknown");
  });
  test("unlimited is explicit", () => {
    expect(formatMetricValue({ ...base, unlimited: true, valueText: null })).toBe("unlimited");
  });
});
