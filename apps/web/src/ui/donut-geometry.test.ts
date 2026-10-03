import { describe, expect, test } from "bun:test";

import {
  arcAt,
  groupParts,
  layoutArcs,
  otherKey,
  sectorPath,
  shareText,
  sumDisplay,
  thinFade,
} from "./donut-geometry.ts";

const part = (key: string, value: number) => ({ key, value });

describe("groupParts", () => {
  test("keeps few parts as they are and drops zeros", () => {
    const slices = groupParts([part("a", 50), part("b", 0), part("c", 50)]);
    expect(slices.map((slice) => slice.key)).toEqual(["a", "c"]);
    expect(slices.every((slice) => slice.members.length === 0)).toBe(true);
  });

  test("groups parts below the share into one Other at the end", () => {
    const slices = groupParts([part("a", 91), part("b", 3), part("c", 3), part("d", 3)]);
    expect(slices.map((slice) => slice.key)).toEqual(["a", otherKey]);
    expect(slices[1]?.value).toBe(9);
    expect(slices[1]?.members.map((member) => member.key)).toEqual(["b", "c", "d"]);
  });

  test("does not group a single small part", () => {
    const slices = groupParts([part("a", 97), part("b", 3)]);
    expect(slices.map((slice) => slice.key)).toEqual(["a", "b"]);
  });

  test("limits the count, grouping the smallest parts", () => {
    const parts = [30, 20, 15, 12, 10, 8, 5].map((value, index) => part(`p${index}`, value));
    const slices = groupParts(parts);
    expect(slices).toHaveLength(6);
    expect(slices.map((slice) => slice.key)).toEqual(["p0", "p1", "p2", "p3", "p4", otherKey]);
    expect(slices[5]?.members.map((member) => member.key)).toEqual(["p5", "p6"]);
  });

  test("returns nothing for an empty total", () => {
    expect(groupParts([part("a", 0)])).toEqual([]);
  });
});

describe("layoutArcs", () => {
  test("lays parts end to end around the ring", () => {
    const arcs = layoutArcs([part("a", 1), part("b", 3)]);
    expect(arcs).toEqual([
      { key: "a", start: 0, end: 0.25 },
      { key: "b", start: 0.25, end: 1 },
    ]);
  });

  test("gives an empty total zero-width arcs", () => {
    expect(layoutArcs([part("a", 0)])).toEqual([{ key: "a", start: 0, end: 0 }]);
  });
});

describe("shareText", () => {
  test("rounds to whole percent", () => {
    expect(shareText(0.4549)).toBe("45%");
    expect(shareText(1)).toBe("100%");
    expect(shareText(0)).toBe("0%");
  });
  test("marks a real share under one percent", () => {
    expect(shareText(0.004)).toBe("<1%");
  });
});

describe("sumDisplay", () => {
  test("adds money displays in the leading part's format", () => {
    expect(
      sumDisplay([
        { value: 30000, display: "$300" },
        { value: 4000, display: "$40" },
      ]),
    ).toBe("$340");
  });
  test("keeps decimals and grouping", () => {
    expect(
      sumDisplay([
        { value: 120000, display: "$1,200.00" },
        { value: 2501, display: "$25.01" },
      ]),
    ).toBe("$1,225.01");
  });
  test("returns null when no display is a number", () => {
    expect(sumDisplay([{ value: 5, display: "n/a" }])).toBeNull();
    expect(sumDisplay([])).toBeNull();
  });
});

describe("sectorPath", () => {
  const shape = { center: 104, outer: 97, inner: 73, gap: 3, corner: 4 };

  test("draws nothing for an empty or negative span", () => {
    expect(sectorPath({ ...shape, start: 0.2, end: 0.2 })).toBe("");
    expect(sectorPath({ ...shape, start: 0.3, end: 0.1 })).toBe("");
  });

  test("draws a closed outline for a quarter", () => {
    const path = sectorPath({ ...shape, start: 0, end: 0.25 });
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path).not.toContain("NaN");
  });

  test("draws a full ring as two circles", () => {
    const path = sectorPath({ ...shape, start: 0, end: 1 });
    expect(path.match(/M/g)).toHaveLength(2);
  });

  test("keeps the gap between neighbours parallel: both sides sit half a gap off the radius", () => {
    // A quarter starting at the top (turn 0): its start side is the vertical line x = center + gap / 2.
    const sharp = { ...shape, corner: 0, start: 0, end: 0.25 };
    const path = sectorPath(sharp);
    expect(path.startsWith("M105.5 ")).toBe(true);
    expect(path.split("105.5 ").length - 1).toBeGreaterThanOrEqual(2);
  });

  test("a sliver narrows to nothing", () => {
    expect(sectorPath({ ...shape, start: 0, end: 0.0001 })).toBe("");
  });

  test("a thin part is a wedge that still closes", () => {
    const path = sectorPath({ ...shape, start: 0, end: 0.012 });
    expect(path).not.toBe("");
    expect(path).not.toContain("NaN");
  });

  test("a part nearly filling the ring has no NaN", () => {
    const path = sectorPath({ ...shape, start: 0, end: 0.999 });
    expect(path).not.toContain("NaN");
  });
});

describe("thinFade", () => {
  test("is opaque for a wide part and gone for a sliver", () => {
    expect(thinFade(97, 0, 0.25, 3)).toBe(1);
    expect(thinFade(97, 0, 0.0001, 3)).toBe(0);
  });
  test("ramps for parts a few pixels wide", () => {
    const fade = thinFade(97, 0, 0.0095, 3);
    expect(fade).toBeGreaterThan(0);
    expect(fade).toBeLessThan(1);
  });
});

describe("arcAt", () => {
  const arcs = layoutArcs([part("a", 1), part("b", 1)]);
  const ring = { outer: 97, inner: 73 };

  test("finds the part by angle, clockwise from the top", () => {
    expect(arcAt(arcs, { x: 85, y: 0 }, ring)).toBe("a");
    expect(arcAt(arcs, { x: 10, y: 85 }, ring)).toBe("a");
    expect(arcAt(arcs, { x: -85, y: 0 }, ring)).toBe("b");
    expect(arcAt(arcs, { x: -10, y: -85 }, ring)).toBe("b");
  });

  test("returns null off the ring", () => {
    expect(arcAt(arcs, { x: 0, y: 0 }, ring)).toBeNull();
    expect(arcAt(arcs, { x: 120, y: 0 }, ring)).toBeNull();
  });

  test("slack widens the inner edge", () => {
    expect(arcAt(arcs, { x: 70, y: 0 }, ring)).toBeNull();
    expect(arcAt(arcs, { x: 70, y: 0 }, { ...ring, slack: 6 })).toBe("a");
  });
});
