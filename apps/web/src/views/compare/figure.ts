import type { Provider } from "@headroom/core/contracts";

import type { MeterWindow } from "../../lib/accounts.ts";
import { displayMeter, type Caption, type LimitsView, type Tone } from "../../lib/tone.ts";

/** How the owner reads limits: used or left, and where "running low" starts. */
export interface Look {
  readonly view: LimitsView;
  readonly threshold: number;
}

/** Copilot reports tenths; any other figure under 1% keeps one decimal so it does not read as zero. */
function decimalsOf(provider: Provider, used: number): number {
  if (provider === "copilot") return 1;
  return used > 0 && used < 1 ? 1 : 0;
}

/** A figure ready to draw: the words, the bar fill and the tone. Unknown, unlimited and unstarted stay apart from zero. */
export type Figure =
  | { readonly kind: "unlimited" }
  | { readonly kind: "not_started" }
  | { readonly kind: "unknown" }
  | {
      readonly kind: "known";
      /** For example "88% left" or "12%". */
      readonly text: string;
      readonly fill: number;
      readonly tone: Tone;
      readonly caption: Caption | null;
      /** The used percent, for assistive tech. */
      readonly used: number;
    };

/** A figure from a used percent. Null is unknown. */
function figureOfUsed(used: number | null, provider: Provider, look: Look): Figure {
  if (used === null) return { kind: "unknown" };
  const shown = displayMeter(used, look.view, look.threshold, decimalsOf(provider, used));
  if (shown.value === null || shown.fill === null) return { kind: "unknown" };
  return {
    kind: "known",
    text: `${shown.value}${shown.unit}`,
    fill: shown.fill,
    tone: shown.tone ?? "good",
    caption: shown.caption,
    used,
  };
}

export function figureOfWindow(
  window: Pick<MeterWindow, "notStarted" | "used"> & { readonly unlimited?: boolean },
  provider: Provider,
  look: Look,
): Figure {
  if (window.unlimited === true) return { kind: "unlimited" };
  if (window.notStarted) return { kind: "not_started" };
  return figureOfUsed(window.used, provider, look);
}

/** The room left, as the figure of its used share. */
export function figureOfRoom(left: number, provider: Provider, look: Look): Figure {
  return figureOfUsed(100 - left, provider, look);
}
