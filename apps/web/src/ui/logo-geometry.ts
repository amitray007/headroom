/**
 * Headroom mark geometry on a 64 unit grid, shared by the React mark and scripts/brand.ts.
 * Every edge is a multiple of 4, so it lands on whole pixels at 16 px and on half pixels at 32 px.
 * The tile is a continuous-corner squircle. The content is 40 wide and 32 tall, centred
 * vertically with 16 above and below and 12 each side: a ceiling line, then two bars of unequal length.
 */
export const logoSize = 64;

export interface LogoRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
}

export const ceilingRect: LogoRect = { x: 12, y: 16, width: 40, height: 4, radius: 2 };
export const barRects: readonly LogoRect[] = [
  { x: 12, y: 28, width: 28, height: 8, radius: 4 },
  { x: 12, y: 40, width: 16, height: 8, radius: 4 },
];

/** Perceptual lightness (OKLCH L, percent) of the neutral colours. Mirrored by `--logo-*` in tokens.css. */
export const logoLightness = {
  light: { tile: 16, ink: 98.6, ceiling: 62 },
  dark: { tile: 94, ink: 18, ceiling: 56 },
} as const;

const cornerRadius = 15;
// Continuous-corner (squircle) curve constants, in units of the corner radius.
const k = [1.52866483, 1.08849296, 0.86840694, 0.63149379, 0.37282383, 0.16906013, 0.07491176].map(
  (v) => v * cornerRadius,
);

function p(...values: number[]): string {
  return values.map((value) => String(Number(value.toFixed(3)))).join(" ");
}

/** SVG path of the squircle tile covering the whole 64 unit square. */
export function tilePath(size = logoSize): string {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0] = k;
  const s = size;
  return [
    `M${p(a, 0)}H${p(s - a)}`,
    `C${p(s - b, 0, s - c, 0, s - d, g)}C${p(s - e, f, s - f, e, s - g, d)}C${p(s, c, s, b, s, a)}`,
    `V${p(s - a)}`,
    `C${p(s, s - b, s, s - c, s - g, s - d)}C${p(s - f, s - e, s - e, s - f, s - d, s - g)}C${p(s - c, s, s - b, s, s - a, s)}`,
    `H${p(a)}`,
    `C${p(b, s, c, s, d, s - g)}C${p(e, s - f, f, s - e, g, s - d)}C${p(0, s - c, 0, s - b, 0, s - a)}`,
    `V${p(a)}`,
    `C${p(0, b, 0, c, g, d)}C${p(f, e, e, f, d, g)}C${p(c, 0, b, 0, a, 0)}Z`,
  ].join("");
}
