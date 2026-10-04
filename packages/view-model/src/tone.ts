export type Tone = "good" | "warn" | "bad";
export type LimitsView = "used" | "left";
export type Caption = "Over the Limit" | "Almost Out" | "Running Low";

/** Percent left under which a limit is "almost out", whatever the owner's threshold. */
const almostOutBelow = 10;

function left(used: number): number {
  return Math.max(0, 100 - used);
}

/** Tone from the used percent. Unknown stays unknown (null). */
export function toneOf(used: number | null, lowThreshold: number): Tone | null {
  if (used === null) return null;
  const remaining = left(used);
  if (remaining < almostOutBelow) return "bad";
  return remaining < lowThreshold ? "warn" : "good";
}

export function captionOf(used: number | null, lowThreshold: number): Caption | null {
  if (used === null) return null;
  if (used > 100) return "Over the Limit";
  const tone = toneOf(used, lowThreshold);
  if (tone === "bad") return "Almost Out";
  return tone === "warn" ? "Running Low" : null;
}

export interface MeterDisplay {
  readonly tone: Tone | null;
  readonly caption: Caption | null;
  /** The number the owner reads, rounded; null when unknown. */
  readonly value: number | null;
  readonly unit: "%" | "% left";
  /** Bar fill, 0 to 100, following the shown number. Null when unknown. */
  readonly fill: number | null;
}

/** What a meter shows for the owner's view: used percent, or percent left. */
export function displayMeter(
  used: number | null,
  view: LimitsView,
  lowThreshold: number,
  decimals: number,
): MeterDisplay {
  const unit = view === "left" ? "% left" : "%";
  const tone = toneOf(used, lowThreshold);
  const caption = captionOf(used, lowThreshold);
  if (used === null) return { tone, caption, value: null, unit, fill: null };
  const shown = view === "left" ? left(used) : used;
  const value = Number(shown.toFixed(decimals));
  return { tone, caption, value, unit, fill: Math.min(100, Math.max(0, value)) };
}
