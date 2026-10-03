/**
 * Pure maths for the donut chart: grouping small parts, laying parts out as turns of the ring, drawing a ring
 * sector with parallel-sided gaps and rounded corners, and finding the part under a point. Angles are in turns
 * (0 to 1) measured clockwise from the top.
 */

const tau = Math.PI * 2;

/** The key of the part that holds the grouped small parts. */
export const otherKey = "__other";

export interface Part {
  readonly key: string;
  readonly value: number;
}

/** One drawn part: a single input part, or the group of small ones (`item` is null and `members` lists them). */
export interface Slice<T extends Part> {
  readonly key: string;
  readonly value: number;
  readonly item: T | null;
  readonly members: readonly T[];
}

/**
 * The parts to draw. Parts of zero or less are dropped. A part below `groupBelow` of the total, and any part
 * beyond `maxSlices` (counting the group), joins one "Other" slice at the end, but only when at least two parts
 * would: grouping a single part hides it for nothing. Other parts keep their input order.
 */
export function groupParts<T extends Part>(
  parts: readonly T[],
  options: { readonly groupBelow?: number; readonly maxSlices?: number } = {},
): Slice<T>[] {
  const { groupBelow = 0.04, maxSlices = 6 } = options;
  const live = parts.filter((part) => part.value > 0);
  const total = live.reduce((sum, part) => sum + part.value, 0);
  const single = (part: T): Slice<T> => ({
    key: part.key,
    value: part.value,
    item: part,
    members: [],
  });
  if (total <= 0) return [];
  const ranked = live.toSorted((a, b) => b.value - a.value);
  const kept = new Set(
    ranked
      .filter((part, rank) => part.value / total >= groupBelow && rank < maxSlices - 1)
      .map((part) => part.key),
  );
  const rest = live.filter((part) => !kept.has(part.key));
  if (rest.length < 2) return live.map(single);
  return [
    ...live.filter((part) => kept.has(part.key)).map(single),
    {
      key: otherKey,
      value: rest.reduce((sum, part) => sum + part.value, 0),
      item: null,
      members: rest,
    },
  ];
}

export interface Arc {
  readonly key: string;
  readonly start: number;
  readonly end: number;
}

/** Contiguous arcs, in order, each as wide as its share of the total. */
export function layoutArcs(parts: readonly Part[]): Arc[] {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  let at = 0;
  return parts.map((part) => {
    const start = at;
    at += total > 0 ? Math.max(0, part.value) / total : 0;
    return { key: part.key, start, end: at };
  });
}

/** "42%", or "<1%" for a part that is real but under one percent. */
export function shareText(share: number): string {
  if (share > 0 && share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}

const numberPattern = /^(\D*?)(\d[\d,]*(?:\.(\d+))?)(\D*)$/;

/**
 * The display for a group of parts, derived from the parts' own display strings: the largest part's display
 * sets the prefix, suffix, decimals and scale, so "$300" and "$40" give "$340" for the pair. Null when no
 * display reads as a number.
 */
export function sumDisplay(
  members: readonly { readonly value: number; readonly display: string }[],
): string | null {
  const total = members.reduce((sum, member) => sum + member.value, 0);
  const lead = members.toSorted((a, b) => b.value - a.value).find((member) => member.value > 0);
  if (lead === undefined) return null;
  const match = numberPattern.exec(lead.display);
  if (match === null) return null;
  const [, prefix = "", figure = "", fraction, suffix = ""] = match;
  const scale = Number(figure.replaceAll(",", "")) / lead.value;
  const decimals = fraction?.length ?? 0;
  const text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: figure.includes(","),
  }).format(total * scale);
  return `${prefix}${text}${suffix}`;
}

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The outline of one ring sector from turn `start` to turn `end`. Its sides run parallel to the radius, `gap`
 * apart from the neighbouring sector, so the gap is the same width from the inner edge to the outer one. All four
 * corners are rounded by `corner` where there is room. A thin sector narrows to a wedge and then to nothing, so a
 * closing part never pops. A part that fills the ring is a full ring with no gap. Empty text means nothing to draw.
 */
export function sectorPath(shape: {
  readonly center: number;
  readonly outer: number;
  readonly inner: number;
  readonly start: number;
  readonly end: number;
  readonly gap: number;
  readonly corner: number;
}): string {
  const { center: c, outer, inner, start, end, gap, corner } = shape;
  const turns = end - start;
  if (turns <= 1e-6) return "";
  const at = (radius: number, angle: number): string =>
    `${num(c + radius * Math.cos(angle))} ${num(c + radius * Math.sin(angle))}`;
  if (turns >= 1 - 1e-6) {
    const top = -Math.PI / 2;
    const ring = (radius: number, sweep: 0 | 1): string =>
      `M${at(radius, top)}A${num(radius)} ${num(radius)} 0 1 ${sweep} ${at(radius, top + Math.PI)}` +
      `A${num(radius)} ${num(radius)} 0 1 ${sweep} ${at(radius, top)}Z`;
    return ring(outer, 1) + ring(inner, 0);
  }
  // Half the gap sits on each side. A part that is nearly the whole ring closes its gap, so it never jumps.
  const p = Math.min(gap / 2, ((1 - turns) * tau * outer) / 2);
  const a0 = start * tau - Math.PI / 2;
  const a1 = end * tau - Math.PI / 2;
  const half = (a1 - a0) / 2;
  const s = Math.sin(Math.min(half, Math.PI / 2));
  if (s * outer <= p + 1e-6) return "";
  // A point `t` along the radius at angle `angle`, moved `q` to the clockwise side.
  const side = (t: number, angle: number, q: number): string =>
    `${num(c + t * Math.cos(angle) - q * Math.sin(angle))} ${num(c + t * Math.sin(angle) + q * Math.cos(angle))}`;
  const band = (outer - inner) / 2;

  // Outer corners: a fillet tangent to the side line and to the inside of the outer circle.
  const ro = Math.max(0, Math.min(corner, band, (s * outer - p) / (1 + s)));
  const dO = Math.asin(Math.min(1, (p + ro) / (outer - ro)));
  const tO = Math.sqrt(Math.max(0, (outer - ro) ** 2 - (p + ro) ** 2));
  let d = `M${side(tO, a0, p)}`;
  if (ro > 0.01) d += `A${num(ro)} ${num(ro)} 0 0 1 ${at(outer, a0 + dO)}`;
  d += `A${num(outer)} ${num(outer)} 0 ${a1 - a0 - 2 * dO > Math.PI ? 1 : 0} 1 ${at(outer, a1 - dO)}`;
  if (ro > 0.01) d += `A${num(ro)} ${num(ro)} 0 0 1 ${side(tO, a1, -p)}`;

  if (s * inner > p + 1e-6 || s >= 0.9999) {
    // Inner corners: a fillet tangent to the side line and to the outside of the inner circle.
    const ri = Math.max(
      0,
      Math.min(corner, band, s >= 0.9999 ? Infinity : (s * inner - p) / (1 - s)),
    );
    const dI = Math.asin(Math.min(1, (p + ri) / (inner + ri)));
    const tI = Math.sqrt(Math.max(0, (inner + ri) ** 2 - (p + ri) ** 2));
    d += `L${side(tI, a1, -p)}`;
    if (ri > 0.01) d += `A${num(ri)} ${num(ri)} 0 0 1 ${at(inner, a1 - dI)}`;
    d += `A${num(inner)} ${num(inner)} 0 ${a1 - a0 - 2 * dI > Math.PI ? 1 : 0} 0 ${at(inner, a0 + dI)}`;
    if (ri > 0.01) d += `A${num(ri)} ${num(ri)} 0 0 1 ${side(tI, a0, p)}`;
  } else {
    // Too thin to reach the inner circle: the two side lines meet in a point.
    d += `L${at(p / s, (a0 + a1) / 2)}`;
  }
  return `${d}Z`;
}

/** Opacity for a sector: a part narrower than a few pixels fades out instead of drawing a hairline. */
export function thinFade(outer: number, start: number, end: number, gap: number): number {
  const turns = end - start;
  if (turns >= 1 - 1e-6) return 1;
  const width = Math.sin(Math.min(turns * Math.PI, Math.PI / 2)) * outer - gap / 2;
  return Math.min(1, Math.max(0, (width - 1) / 3));
}

/**
 * The key of the arc under a point, given relative to the ring's centre, or null when the point is off the ring.
 * `slack` widens the inner edge so a pointer near the ring still counts.
 */
export function arcAt(
  arcs: readonly Arc[],
  point: { readonly x: number; readonly y: number },
  ring: { readonly outer: number; readonly inner: number; readonly slack?: number },
): string | null {
  const radius = Math.hypot(point.x, point.y);
  if (radius < ring.inner - (ring.slack ?? 0) || radius > ring.outer + (ring.slack ?? 0))
    return null;
  let turn = (Math.atan2(point.y, point.x) + Math.PI / 2) / tau;
  if (turn < 0) turn += 1;
  const found = arcs.find((arc) => arc.end > arc.start && turn >= arc.start && turn < arc.end);
  return found?.key ?? null;
}
