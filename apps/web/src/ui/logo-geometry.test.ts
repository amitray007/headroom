import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { barRects, ceilingRect, logoLightness, logoSize } from "./logo-geometry.ts";

test("mark content sits inside the tile on the 4 unit grid, centred vertically", () => {
  const rects = [ceilingRect, ...barRects];
  for (const r of rects) {
    expect(r.x % 4).toBe(0);
    expect(r.y % 4).toBe(0);
    expect(r.width % 4).toBe(0);
    expect(r.height % 4).toBe(0);
  }
  const top = Math.min(...rects.map((r) => r.y));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  expect(top).toBe(logoSize - bottom);
});

test("tokens.css mirrors the logo lightness values", () => {
  const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
  const { light, dark } = logoLightness;
  expect(css).toContain(
    `--logo-tile: light-dark(oklch(${light.tile}% 0 0), oklch(${dark.tile}% 0 0))`,
  );
  expect(css).toContain(
    `--logo-ink: light-dark(oklch(${light.ink}% 0 0), oklch(${dark.ink}% 0 0))`,
  );
  expect(css).toContain(
    `--logo-ceiling: light-dark(oklch(${light.ceiling}% 0 0), oklch(${dark.ceiling}% 0 0))`,
  );
});
