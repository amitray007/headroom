import { describe, expect, test } from "bun:test";

import { captionOf, displayMeter, toneOf } from "./tone.ts";

describe("toneOf", () => {
  test("uses percent left against the threshold", () => {
    expect(toneOf(60, 30)).toBe("good");
    expect(toneOf(70, 30)).toBe("good"); // exactly 30 left is not low
    expect(toneOf(71, 30)).toBe("warn");
    expect(toneOf(71, 15)).toBe("good");
    expect(toneOf(85, 15)).toBe("good"); // exactly 15 left
    expect(toneOf(86, 15)).toBe("warn");
    expect(toneOf(90, 30)).toBe("warn"); // exactly 10 left is not almost out
    expect(toneOf(90.5, 30)).toBe("bad");
    expect(toneOf(112, 30)).toBe("bad");
  });
  test("unknown stays unknown", () => {
    expect(toneOf(null, 30)).toBeNull();
    expect(captionOf(null, 30)).toBeNull();
  });
  test("captions", () => {
    expect(captionOf(10, 30)).toBeNull();
    expect(captionOf(78, 30)).toBe("Running Low");
    expect(captionOf(91, 30)).toBe("Almost Out");
    expect(captionOf(100, 30)).toBe("Almost Out");
    expect(captionOf(112, 30)).toBe("Over the Limit");
  });
});

describe("displayMeter", () => {
  test("used view shows used and fills to it", () => {
    expect(displayMeter(78, "used", 30, 0)).toEqual({
      tone: "warn",
      caption: "Running Low",
      value: 78,
      unit: "%",
      fill: 78,
    });
  });
  test("left view shows what remains and fills to it", () => {
    expect(displayMeter(78, "left", 30, 0)).toEqual({
      tone: "warn",
      caption: "Running Low",
      value: 22,
      unit: "% left",
      fill: 22,
    });
  });
  test("decimals", () => {
    expect(displayMeter(0.8, "used", 30, 1).value).toBe(0.8);
    expect(displayMeter(19.02, "left", 30, 1).value).toBe(81);
  });
  test("over the limit clamps the fill, not the number", () => {
    const shown = displayMeter(112, "used", 30, 0);
    expect(shown.value).toBe(112);
    expect(shown.fill).toBe(100);
    expect(displayMeter(112, "left", 30, 0).value).toBe(0);
  });
  test("unknown has no number and no fill", () => {
    expect(displayMeter(null, "left", 30, 0)).toEqual({
      tone: null,
      caption: null,
      value: null,
      unit: "% left",
      fill: null,
    });
  });
});
