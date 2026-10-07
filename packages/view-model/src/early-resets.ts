import type { OverviewConnection } from "./overview.ts";
import { countdown } from "./time.ts";
import type { LimitsView } from "./tone.ts";

/** Limits that Headroom saw reset before their scheduled time (ADR 0003, `early_reset`), and how to word them. */

export interface EarlyReset {
  readonly id: string;
  readonly metricKey: string;
  readonly at: number;
  /** Percent used before and after the drop. */
  readonly from: number;
  readonly to: number;
  /** When the limit was due to reset on its own. */
  readonly expectedAt: number;
  /** A banked reset left the inventory at the same time, so it was spent outside Headroom. */
  readonly bankedUsed: boolean;
}

/** Every early reset of an account that names a limit, newest first. */
export function earlyResetsOf(connection: Pick<OverviewConnection, "events">): EarlyReset[] {
  const resets: EarlyReset[] = [];
  for (const event of connection.events) {
    const { detail } = event;
    if (detail.kind !== "early_reset" || event.metricKey === null) continue;
    resets.push({
      id: event.id,
      metricKey: event.metricKey,
      at: event.occurredAt,
      from: detail.previousPercent,
      to: detail.percent,
      expectedAt: detail.expectedResetAt,
      bankedUsed: detail.bankedUsed === true,
    });
  }
  return resets.toSorted((a, b) => b.at - a.at);
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

/** "Banked Reset Used" when a banked reset explains it, else "Reset Early". */
export function earlyResetTitle(reset: EarlyReset): string {
  return reset.bankedUsed ? "Banked Reset Used" : "Reset Early";
}

/** The figures of an early reset in the owner's used or left view: "41% → 1% used · 2 days 5 h early". */
export function earlyResetLine(reset: EarlyReset, view: LimitsView): string {
  const shown = (used: number): string => pct(view === "left" ? Math.max(0, 100 - used) : used);
  const word = view === "left" ? "left" : "used";
  return `${shown(reset.from)} → ${shown(reset.to)} ${word} · ${countdown(reset.expectedAt, reset.at)} early`;
}
