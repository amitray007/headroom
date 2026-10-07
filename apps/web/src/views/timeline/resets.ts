import type { OverviewConnection } from "../../api.ts";
import { isInactive, meterWindows } from "@headroom/view-model/accounts";
import { countdown, shortDate, type Clock } from "@headroom/view-model/time";
import type { LimitsView } from "@headroom/view-model/tone";

/**
 * The Recent Resets table: resets the owner did not start, from the account events of the last 7 days (ADR 0003).
 * A limit that reset early, a banked reset spent outside Headroom, an auto-reset Headroom ran, and a new banked
 * reset from the provider. A press of Hold to Reset and a reset on schedule are left out: the owner already knows.
 * Pure, so the wording can be tested.
 */

type ResetMark = "early" | "bank" | "auto" | "bad";

export interface ResetRow {
  readonly id: string;
  readonly connection: OverviewConnection;
  readonly at: number;
  /** The colour of the row's mark: early matches the Timeline marker, bank the banked-reset ticks. */
  readonly mark: ResetMark;
  /** "Weekly", "Weekly Opus", or "Banked Resets" for a new one. */
  readonly limit: string;
  /** The row is about a limit, not the banked-reset inventory, so the phone list names the limit too. */
  readonly onLimit: boolean;
  readonly what: string;
  /** A short second fact, such as "2 days early" or "Expires Oct 30". */
  readonly detail: string | null;
  /** The figure that changed, in the owner's used or left view; null when there is none. */
  readonly change: string | null;
  readonly inactive: boolean;
}

export interface ResetWords {
  readonly now: number;
  readonly clock: Clock;
  readonly view: LimitsView;
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

function shown(used: number, view: LimitsView): number {
  return view === "left" ? Math.max(0, 100 - used) : used;
}

/** How long before its scheduled reset the limit reset: "2 days 5 h early". */
function early(at: number, due: number): string {
  return `${countdown(due, at)} early`;
}

function rowsOf(connection: OverviewConnection, words: ResetWords): ResetRow[] {
  const meters = meterWindows(connection);
  const limitOf = (key: string | null): string =>
    meters.find((meter) => meter.key === key)?.short ?? "Limit";
  const word = words.view === "left" ? "left" : "used";
  const inactive = isInactive(connection);
  const rows: ResetRow[] = [];
  for (const event of connection.events) {
    const { detail } = event;
    const base = { id: event.id, connection, at: event.occurredAt, inactive };
    if (detail.kind === "early_reset") {
      rows.push({
        ...base,
        mark: detail.bankedUsed === true ? "bank" : "early",
        limit: limitOf(event.metricKey),
        onLimit: true,
        what: detail.bankedUsed === true ? "Banked reset used outside Headroom" : "Reset early",
        detail: early(event.occurredAt, detail.expectedResetAt),
        change: `${pct(shown(detail.previousPercent, words.view))} → ${pct(shown(detail.percent, words.view))} ${word}`,
      });
    } else if (detail.kind === "auto_reset") {
      const what = {
        succeeded: "Auto-reset by Headroom",
        failed: "Auto-reset failed",
        uncertain: "Auto-reset not confirmed",
      }[detail.state];
      rows.push({
        ...base,
        mark: detail.state === "succeeded" ? "auto" : "bad",
        limit: limitOf(event.metricKey),
        onLimit: true,
        what,
        detail: early(event.occurredAt, detail.resetsAt),
        change: `At ${pct(shown(detail.percent, words.view))} ${word}`,
      });
    } else if (detail.kind === "reset_granted") {
      const claude = connection.provider === "claude";
      rows.push({
        ...base,
        mark: "bank",
        limit: claude ? "Reset Grants" : "Banked Resets",
        onLimit: false,
        what: claude ? "New reset grant" : "New banked reset",
        detail: detail.expiresAt === null ? null : `Expires ${shortDate(detail.expiresAt)}`,
        change: detail.available === null ? null : `${detail.available} available`,
      });
    }
  }
  return rows;
}

/** Every account's resets, newest first. */
export function resetRows(
  connections: readonly OverviewConnection[],
  words: ResetWords,
): ResetRow[] {
  return connections
    .flatMap((connection) => rowsOf(connection, words))
    .toSorted((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}
