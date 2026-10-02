import type { CSSProperties } from "react";

import { BrandMark } from "../../icons.tsx";
import { accountName, planLabel, providerName, statusOf } from "../../lib/labels.ts";
import { meterWindows } from "../../lib/accounts.ts";
import { countdown, exactFull } from "../../lib/time.ts";
import { toneOf, displayMeter, type Tone } from "../../lib/tone.ts";
import { cx } from "../../ui/cx.ts";
import { StatusPill, type StatusKind } from "../../ui/pill.tsx";
import { limitName, type Lane, type LaneGroup } from "./lanes.ts";
import {
  clockText,
  columnOf,
  elapsedShare,
  placeSpan,
  positionOf,
  resetShort,
  shortDay,
  weekday,
  type Axis,
  type Box,
} from "./range.ts";
import { bankTipId, tipLabel, usedText, windowTipId, type TipContext } from "./tips.ts";
import type { PopoverContent } from "../../ui/hover-popover.tsx";

type Tips = ReadonlyMap<string, PopoverContent>;

const statusKinds: Record<ReturnType<typeof statusOf>["word"], StatusKind> = {
  Active: "active",
  Paused: "paused",
  Disconnected: "disconnected",
  "Refresh Failed": "refresh_failed",
  "Out of Date": "out_of_date",
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** A style with one custom property: the row's place in the order, for the staggered entrance. */
function rowStyle(index: number): CSSProperties {
  const style: CSSProperties & Record<string, string> = {};
  style["--i"] = String(index);
  return style;
}

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
function LaneBars(props: {
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
      const tone = lane.used === null ? null : toneOf(lane.used, low);
      const shown = lane.used === null ? null : displayMeter(lane.used, view, low, 0);
      nodes.push(
        <WindowBar
          key="cur"
          tipId={tipId}
          tips={tips}
          variant="cur"
          box={current}
          tone={tone}
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
  return <>{nodes}</>;
}

/** Name, plan, status, identity and a chip for each limit. The chip for the shown window kind is marked. */
function WhoCell(props: { readonly lane: Lane; readonly context: TipContext }) {
  const { lane, context } = props;
  const { connection } = lane;
  const status = statusOf(connection);
  const plan = planLabel(connection.plan);
  return (
    <div className="tl-who-cell">
      <div className="tl-id">
        <span className="tl-nm">
          {accountName(connection)}
          {plan === null ? null : <span className="tl-plan">{` · ${plan}`}</span>}
        </span>
        {status.word === "Active" ? null : <StatusPill kind={statusKinds[status.word]} />}
      </div>
      {connection.identity === null ? null : (
        <div className="who tl-ident">{connection.identity}</div>
      )}
      <div className="tl-chips">
        {meterWindows(connection)
          .filter((meter) => !meter.unlimited)
          .map((meter) => {
            const tone = meter.used === null ? null : toneOf(meter.used, context.low);
            const shown =
              meter.used === null ? null : displayMeter(meter.used, context.view, context.low, 0);
            return (
              <span key={meter.key} className={cx("tl-chip", meter.kind === lane.kind && "tl-on")}>
                {tone === null ? null : <i className="tl-dot" data-tone={tone} />}
                {limitName(meter)}{" "}
                <b>
                  {shown !== null ? `${shown.value ?? 0}%` : meter.notStarted ? "Not Started" : "—"}
                </b>
              </span>
            );
          })}
      </div>
    </div>
  );
}

function GroupHeader(props: { readonly group: LaneGroup }) {
  const { group } = props;
  return (
    <div className="tl-grp">
      <BrandMark provider={group.provider} />
      <b>{providerName(group.provider)}</b>
      <span>{plural(group.lanes.length, "Account")}</span>
    </div>
  );
}

function ColumnHead(props: {
  readonly axis: Axis;
  readonly start: number;
  readonly index: number;
  readonly now: boolean;
  readonly clock: TipContext["clock"];
}) {
  const { axis, start, index } = props;
  let top = "";
  let bottom = "";
  if (axis.kind === "weekly") {
    top = weekday(start);
    bottom = shortDay(start);
  } else if (axis.kind === "session") {
    const midnight = new Date(start).getHours() === 0;
    top = index === 0 || midnight ? `${weekday(start)} ${new Date(start).getDate()}` : "";
    bottom = clockText(start, props.clock);
  } else {
    top = "Week of";
    bottom = shortDay(start);
  }
  return (
    <div className={cx("tl-col", props.now && "tl-today")}>
      <span>{top}</span>
      <b>{bottom}</b>
    </div>
  );
}

/** The desktop grid: day headers, the Now line, provider groups, one lane per account. */
export function TimelineGrid(props: {
  readonly axis: Axis;
  readonly groups: readonly LaneGroup[];
  readonly tips: Tips;
  readonly context: TipContext;
}) {
  const { axis, groups, tips, context } = props;
  const nowX = positionOf(axis, context.now);
  const nowColumn = columnOf(axis, context.now);
  const gridStyle: CSSProperties & Record<string, string> = {};
  gridStyle["--cols"] = String(axis.columns.length);
  let index = 0;
  return (
    <div className="tl-grid" style={gridStyle}>
      <div className="tl-hrow">
        <div className="tl-corner">
          Account<span>{`Limits · ${context.view === "left" ? "Left" : "Used"}`}</span>
        </div>
        <div className="tl-cols">
          {axis.columns.map((start, column) => (
            <ColumnHead
              key={start}
              axis={axis}
              start={start}
              index={column}
              now={nowColumn === column}
              clock={context.clock}
            />
          ))}
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.provider} className="tl-set">
          <GroupHeader group={group} />
          {group.lanes.map((lane) => (
            <div
              key={lane.id}
              className={cx("tl-row", lane.inactive && "tl-dim")}
              style={rowStyle(index++)}
            >
              <WhoCell lane={lane} context={context} />
              <div className="tl-track">
                <div className="tl-bars">
                  <LaneBars lane={lane} axis={axis} tips={tips} context={context} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
      <div className="tl-plot" aria-hidden="true">
        {nowColumn === null ? null : (
          <span
            className="tl-todaycol"
            style={{
              left: `${(nowColumn / axis.columns.length) * 100}%`,
              width: `${100 / axis.columns.length}%`,
            }}
          />
        )}
        {nowX === null ? null : (
          <span className="tl-nowline" style={{ left: `${nowX}%` }}>
            <b>Now</b>
          </span>
        )}
      </div>
    </div>
  );
}

/** The phone list: a mini timeline per account, the current window and the next one. */
export function TimelineList(props: {
  readonly groups: readonly LaneGroup[];
  readonly tips: Tips;
  readonly context: TipContext;
}) {
  const { groups, tips, context } = props;
  const { now, clock } = context;
  let index = 0;
  return (
    <div className="tl-lists">
      {groups.map((group) => (
        <div key={group.provider} className="tl-set">
          <GroupHeader group={group} />
          {group.lanes.map((lane) => {
            const span = lane.phase === "current" ? lane.lengthMs * 2 : lane.lengthMs;
            const axis = { base: lane.start, end: lane.start + span };
            const caption =
              lane.phase === "idle"
                ? "Not Started · Opens when you next use it"
                : lane.phase === "ended"
                  ? `Ended ${resetShort(lane.kind, lane.end, clock)}`
                  : `${lane.kind === "cycle" ? "Cycle ends" : "Resets"} in ${countdown(lane.end, now)} · ${exactFull(lane.end, now, clock)}`;
            return (
              <div
                key={lane.id}
                className={cx("tl-mrow", lane.inactive && "tl-dim")}
                style={rowStyle(index++)}
              >
                <WhoCell lane={lane} context={context} />
                <div className="tl-mini">
                  <div className="tl-bars">
                    <LaneBars lane={lane} axis={axis} tips={tips} context={context} />
                  </div>
                </div>
                <p className="tl-mcap">{caption}</p>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
