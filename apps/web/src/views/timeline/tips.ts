import type { OverviewConnection } from "../../api.ts";
import { accountName, providerName } from "../../lib/labels.ts";
import { resetVerb } from "../../lib/reset-caption.tsx";
import { age, countdown, exactFull, type Clock } from "../../lib/time.ts";
import { displayMeter, toneOf, type LimitsView } from "../../lib/tone.ts";
import type { PopoverContent } from "../../ui/hover-popover.tsx";
import { timelineKinds, type Bank, type Lane } from "./lanes.ts";

/** The popover wording for every bar and tick of the Timeline. Pure, so the words can be tested. */

export interface TipContext {
  readonly now: number;
  readonly clock: Clock;
  readonly view: LimitsView;
  readonly low: number;
}

export type Role = "prev" | "cur" | "next";

export function windowTipId(lane: Lane, role: Role): string {
  return `${lane.id}:${role}`;
}

export function bankTipId(lane: Lane, bank: Bank): string {
  return `${lane.id}:bank:${bank.index}`;
}

/** "91% Used" or "36% Left"; "Not reported" when the provider gave no figure. */
export function usedText(used: number | null, context: TipContext): string {
  if (used === null) return "Not reported";
  const shown = displayMeter(used, context.view, context.low, 0);
  return `${shown.value ?? 0}% ${context.view === "left" ? "Left" : "Used"}`;
}

/** "Claude · Personal". */
export function laneName(connection: OverviewConnection): string {
  return `${providerName(connection.provider)} · ${accountName(connection)}`;
}

export function kindLabel(kind: Lane["kind"]): string {
  return timelineKinds.find((entry) => entry.value === kind)?.label ?? kind;
}

const staleLines = (lane: Lane, context: TipContext): { text: string }[] => {
  const observed = lane.connection.snapshot?.observedAt;
  return lane.inactive && observed !== undefined
    ? [{ text: `Numbers from ${age(observed, context.now)}` }]
    : [];
};

/** What each bar says. The earlier window is worked out from the window length, and the popover says so. */
export function windowTip(lane: Lane, role: Role, context: TipContext): PopoverContent {
  const { now, clock } = context;
  const title = `${laneName(lane.connection)} · ${kindLabel(lane.kind)}`;
  const stale = staleLines(lane, context);
  if (role === "prev") {
    const start = lane.start - lane.lengthMs;
    return {
      title,
      when: `Earlier window · ended ${exactFull(lane.start, now, clock)}`,
      lines: [
        { text: `Opened ${exactFull(start, now, clock)}` },
        { text: "Worked out from the window length" },
      ],
    };
  }
  if (role === "next") {
    const idleNext = lane.kind === "session";
    return {
      title,
      when: idleNext
        ? "Next window · starts on next use"
        : `Next window · opens ${exactFull(lane.end, now, clock)}`,
      lines: [
        ...(idleNext
          ? []
          : [{ text: `Resets ${exactFull(lane.end + lane.lengthMs, now, clock)}` }]),
        { text: "Opens when this one resets" },
      ],
    };
  }
  if (lane.phase === "idle") {
    return {
      title,
      when: "Not Started",
      lines: [{ text: "Opens when you next use it" }, ...stale],
    };
  }
  const meters = lane.meters.map((meter) => ({
    text: `${usedText(meter.used, context)} · ${meter.short}`,
    tone: meter.used === null ? null : toneOf(meter.used, context.low),
  }));
  if (lane.phase === "ended") {
    return {
      title,
      when: `Ended ${exactFull(lane.end, now, clock)}`,
      lines: [
        ...meters,
        { text: `Opened ${exactFull(lane.start, now, clock)}` },
        { text: "Last reading, from before it ended" },
        ...stale,
      ],
    };
  }
  const passed = Math.round(
    Math.min(1, Math.max(0, (now - lane.start) / (lane.end - lane.start))) * 100,
  );
  const verb = resetVerb(lane.drawn.resetWords);
  return {
    title,
    when: `${verb} in ${countdown(lane.end, now)} · ${exactFull(lane.end, now, clock)}`,
    lines: [
      ...meters,
      { text: `Opened ${exactFull(lane.start, now, clock)}` },
      { text: `${passed}% of the window has passed` },
      ...stale,
    ],
  };
}

function bankTip(lane: Lane, bank: Bank, context: TipContext): PopoverContent {
  return {
    title: `${laneName(lane.connection)} · ${bank.label} Expires`,
    when: `Expires in ${countdown(bank.at, context.now)} · ${exactFull(bank.at, context.now, context.clock)}`,
    lines: [{ text: `${bank.index + 1} of ${bank.count} banked` }],
  };
}

/** The popover as one sentence, for a button's accessible name. */
export function tipLabel(tip: PopoverContent): string {
  return [tip.title, tip.when, ...tip.lines.map((line) => line.text)]
    .filter((part): part is string => part !== undefined)
    .join(". ");
}

/** Every popover of a set of lanes, by id. */
export function laneTips(lanes: readonly Lane[], context: TipContext): Map<string, PopoverContent> {
  const tips = new Map<string, PopoverContent>();
  for (const lane of lanes) {
    const roles: Role[] = lane.phase === "current" ? ["prev", "cur", "next"] : ["cur"];
    for (const role of roles) tips.set(windowTipId(lane, role), windowTip(lane, role, context));
    for (const bank of lane.banks) tips.set(bankTipId(lane, bank), bankTip(lane, bank, context));
  }
  return tips;
}
