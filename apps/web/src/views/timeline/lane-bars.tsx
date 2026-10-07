import { displayMeter, type Tone } from "@headroom/view-model/tone";
import { cx } from "../../ui/cx.ts";
import type { PopoverContent } from "../../ui/hover-popover.tsx";
import type { Lane } from "./lanes.ts";
import {
  elapsedShare,
  placeSpan,
  positionOf,
  resetShort,
  shortDay,
  type Axis,
  type Box,
} from "./range.ts";
import { bankTipId, earlyTipId, tipLabel, usedText, windowTipId, type TipContext } from "./tips.ts";

export type Tips = ReadonlyMap<string, PopoverContent>;

/** The window bar: a button, so the keyboard reaches it and the popover opens on focus. */
function WindowBar(props: {
  readonly tipId: string;
  readonly tips: Tips;
  readonly variant: "cur" | "prev" | "next" | "idle";
  readonly box: Box;
  readonly text: string;
  readonly tone?: Tone | null;
  /** Share of the visible bar that has passed, 0 to 1. */
  readonly elapsed?: number;
  /** Fill of the thin usage strip, 0 to 100. */
  readonly strip?: number | null;
}) {
  const { box, tipId, tips, variant, tone, elapsed = 0, strip = null } = props;
  const tip = tips.get(tipId);
  return (
    <button
      type="button"
      className={cx(
        "tl-win",
        `tl-${variant}`,
        box.cutStart && "tl-cut-l",
        box.cutEnd && "tl-cut-r",
      )}
      data-tone={tone ?? undefined}
      style={{ left: `${box.left}%`, width: `${box.width}%` }}
      data-tip={tipId}
      aria-label={tip === undefined ? props.text : tipLabel(tip)}
    >
      {elapsed > 0 ? <span className="tl-el" style={{ width: `${elapsed * 100}%` }} /> : null}
      <span className="tl-txt">{props.text}</span>
      {strip === null ? null : (
        <span className="tl-strip">
          <i style={{ width: `${strip}%` }} />
        </span>
      )}
    </button>
  );
}

/** Bars and ticks for one lane on an axis. */
/** The bars of one lane: the earlier window, the current one, the next one, banked-reset ticks and early resets. */
export function LaneBars(props: {
  readonly lane: Lane;
  readonly axis: Pick<Axis, "base" | "end">;
  readonly tips: Tips;
  readonly context: TipContext;
}) {
  const { lane, axis, tips, context } = props;
  const { now, clock, view, low } = context;
  const { kind } = lane;
  const nodes = [];

  if (lane.phase === "current" && kind !== "session") {
    const box = placeSpan(axis, lane.start - lane.lengthMs, lane.start);
    if (box !== null) {
      nodes.push(
        <WindowBar
          key="prev"
          tipId={windowTipId(lane, "prev")}
          tips={tips}
          variant="prev"
          box={box}
          text={`Ended ${shortDay(lane.start)}`}
        />,
      );
    }
  }

  const current = placeSpan(axis, lane.start, lane.end);
  if (current !== null) {
    const tipId = windowTipId(lane, "cur");
    if (lane.phase === "idle") {
      nodes.push(
        <WindowBar
          key="cur"
          tipId={tipId}
          tips={tips}
          variant="idle"
          box={current}
          text="Not Started"
        />,
      );
    } else if (lane.phase === "ended") {
      nodes.push(
        <WindowBar
          key="cur"
          tipId={tipId}
          tips={tips}
          variant="prev"
          box={current}
          text={`Ended ${resetShort(kind, lane.end, clock)}`}
        />,
      );
    } else {
      const shown = lane.used === null ? null : displayMeter(lane.used, view, low, 0);
      nodes.push(
        <WindowBar
          key="cur"
          tipId={tipId}
          tips={tips}
          variant="cur"
          box={current}
          tone={shown?.tone ?? null}
          elapsed={elapsedShare(current, now)}
          strip={shown?.fill ?? null}
          text={`${usedText(lane.used, context).replace("Not reported", "Not Reported")} · ${resetShort(kind, lane.end, clock)}`}
        />,
      );
    }
  }

  if (lane.phase === "current") {
    const box = placeSpan(axis, lane.end, lane.end + lane.lengthMs);
    if (box !== null) {
      nodes.push(
        <WindowBar
          key="next"
          tipId={windowTipId(lane, "next")}
          tips={tips}
          variant="next"
          box={box}
          text={
            kind === "session"
              ? "Starts On Next Use"
              : `Next · ${shortDay(lane.end + lane.lengthMs)}`
          }
        />,
      );
    }
  }

  for (const bank of lane.banks) {
    const x = positionOf(axis, bank.at);
    if (x === null) continue;
    const id = bankTipId(lane, bank);
    const tip = tips.get(id);
    nodes.push(
      <button
        key={`bank-${bank.index}`}
        type="button"
        className="tl-tick"
        style={{ left: `${x}%` }}
        data-tip={id}
        aria-label={tip === undefined ? `${bank.label} expires` : tipLabel(tip)}
      >
        <i />
      </button>,
    );
  }
  for (const mark of lane.early) {
    const x = positionOf(axis, mark.reset.at);
    if (x === null) continue;
    const id = earlyTipId(lane, mark);
    const tip = tips.get(id);
    nodes.push(
      <button
        key={`early-${mark.index}`}
        type="button"
        className="tl-tick tl-early"
        // Kept a dot's width inside the lane, so a reset at the window's start is not cut off at the edge.
        style={{ left: `clamp(6px, ${x}%, calc(100% - 6px))` }}
        data-tip={id}
        aria-label={tip === undefined ? "Reset early" : tipLabel(tip)}
      >
        <i />
      </button>,
    );
  }
  return <>{nodes}</>;
}
