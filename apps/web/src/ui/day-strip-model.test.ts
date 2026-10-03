import { describe, expect, test } from "bun:test";

import {
  dayOffset,
  fractionOf,
  labelsToShow,
  monthDayText,
  placeMarks,
  stackShift,
  ticksFor,
} from "./day-strip-model.ts";

describe("dayOffset", () => {
  test("counts whole days in UTC", () => {
    expect(dayOffset("2026-10-04", "2026-10-04")).toBe(0);
    expect(dayOffset("2026-10-04", "2026-10-11")).toBe(7);
    expect(dayOffset("2026-10-04", "2026-11-03")).toBe(30);
    expect(dayOffset("2026-10-04", "2026-10-01")).toBe(-3);
  });

  test("is not moved by a daylight-saving change", () => {
    // Clocks change in the US on 2026-11-01 and in Europe on 2026-10-25.
    expect(dayOffset("2026-10-20", "2026-11-05")).toBe(16);
    expect(dayOffset("2026-03-01", "2026-03-31")).toBe(30);
  });

  test("crosses a leap day", () => {
    expect(dayOffset("2028-02-20", "2028-03-01")).toBe(10);
  });

  test("returns null for an invalid day", () => {
    expect(dayOffset("2026-10-04", "2026-02-30")).toBeNull();
    expect(dayOffset("soon", "2026-10-04")).toBeNull();
  });
});

describe("fractionOf", () => {
  test("maps offsets onto 0 to 1 and clamps", () => {
    expect(fractionOf(0, 30)).toBe(0);
    expect(fractionOf(15, 30)).toBe(0.5);
    expect(fractionOf(30, 30)).toBe(1);
    expect(fractionOf(45, 30)).toBe(1);
    expect(fractionOf(-1, 30)).toBe(0);
    expect(fractionOf(3, 0)).toBe(0);
  });
});

describe("monthDayText", () => {
  test("writes the month and day in UTC", () => {
    expect(monthDayText("2026-10-11")).toBe("Oct 11");
    expect(monthDayText("2026-01-01")).toBe("Jan 1");
  });
});

describe("ticksFor", () => {
  test("places today, +7, +14, +21 and +30 over thirty days", () => {
    const ticks = ticksFor("2026-10-04", 30);
    expect(ticks.map((tick) => tick.label)).toEqual([
      "Today",
      "Oct 11",
      "Oct 18",
      "Oct 25",
      "Nov 3",
    ]);
    expect(ticks.map((tick) => tick.fraction)).toEqual([0, 7 / 30, 14 / 30, 21 / 30, 1]);
  });

  test("keeps only the ticks inside a shorter strip", () => {
    expect(ticksFor("2026-10-04", 14).map((tick) => tick.offset)).toEqual([0, 7, 14]);
    expect(ticksFor("2026-10-04", 3).map((tick) => tick.offset)).toEqual([0]);
  });
});

describe("placeMarks", () => {
  const marks = [
    { key: "c", date: "2026-10-20" },
    { key: "a", date: "2026-10-11" },
    { key: "b", date: "2026-10-11" },
    { key: "late", date: "2026-12-01" },
    { key: "past", date: "2026-10-01" },
    { key: "bad", date: "nope" },
  ];

  test("orders by date, drops marks outside the strip and stacks marks on one day", () => {
    const placed = placeMarks("2026-10-04", 30, marks);
    expect(placed.map((mark) => mark.key)).toEqual(["a", "b", "c"]);
    expect(placed.map((mark) => [mark.stack, mark.stackOf])).toEqual([
      [0, 2],
      [1, 2],
      [0, 1],
    ]);
    expect(placed[0]?.offset).toBe(7);
    expect(placed[2]?.fraction).toBeCloseTo(16 / 30);
  });

  test("keeps the original index so data can be read back", () => {
    expect(placeMarks("2026-10-04", 30, marks).map((mark) => mark.index)).toEqual([1, 2, 0]);
  });

  test("includes today and the last day", () => {
    const placed = placeMarks("2026-10-04", 30, [
      { key: "t", date: "2026-10-04" },
      { key: "e", date: "2026-11-03" },
    ]);
    expect(placed.map((mark) => mark.fraction)).toEqual([0, 1]);
  });
});

describe("stackShift", () => {
  test("keeps a stack centred on its day", () => {
    expect(stackShift(0, 1)).toBe(0);
    expect(stackShift(0, 2)).toBe(-6);
    expect(stackShift(1, 2)).toBe(6);
    expect(stackShift(1, 3)).toBe(0);
  });
});

const layout = (width: number) => ({ width, edge: 10 });

describe("labelsToShow", () => {
  const ticks = ticksFor("2026-10-04", 30);
  const widths = [36, 40, 40, 40, 36];

  test("shows every label when there is room", () => {
    expect([...labelsToShow(ticks, widths, layout(560))]).toEqual([0, 7, 14, 21, 30]);
  });

  test("drops intermediate labels in a narrow strip but keeps Today and the last day", () => {
    const shown = labelsToShow(ticks, widths, layout(200));
    expect(shown.has(0)).toBe(true);
    expect(shown.has(30)).toBe(true);
    expect(shown.size).toBeLessThan(5);
  });

  test("never leaves two shown labels closer than the gap", () => {
    for (let width = 90; width <= 600; width += 5) {
      const shown = labelsToShow(ticks, widths, layout(width));
      const track = width - 20;
      const boxes = ticks.flatMap((tick, index) => {
        if (!shown.has(tick.offset)) return [];
        const w = widths[index] ?? 0;
        if (index === 0) return [{ left: 0, right: w }];
        if (index === ticks.length - 1) return [{ left: width - w, right: width }];
        const at = 10 + tick.fraction * track;
        return [{ left: at - w / 2, right: at + w / 2 }];
      });
      for (let i = 1; i < boxes.length; i += 1) {
        const gap = (boxes[i]?.left ?? 0) - (boxes[i - 1]?.right ?? 0);
        // The two end labels always show, so they alone may crowd each other in a very narrow strip.
        if (boxes.length > 2) expect(gap).toBeGreaterThanOrEqual(8);
      }
    }
  });

  test("keeps only Today when the strip has no other tick", () => {
    expect([...labelsToShow(ticksFor("2026-10-04", 3), [36], layout(200))]).toEqual([0]);
  });

  test("returns nothing for no ticks", () => {
    expect(labelsToShow([], [], layout(200)).size).toBe(0);
  });
});
