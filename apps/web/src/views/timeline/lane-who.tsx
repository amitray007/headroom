import type { CSSProperties } from "react";

import { BrandMark } from "../../icons.tsx";
import { meterWindows } from "@headroom/view-model/accounts";
import { accountName, planLabel, providerName, statusOf } from "@headroom/view-model/labels";
import { displayMeter } from "@headroom/view-model/tone";
import { cx } from "../../ui/cx.ts";
import { StatusPill, statusKindOf } from "../../ui/pill.tsx";
import { limitName, type Lane, type LaneGroup } from "./lanes.ts";
import type { TipContext } from "./tips.ts";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** A style with one custom property: the row's place in the order, for the staggered entrance. */
export function rowStyle(index: number): CSSProperties {
  const style: CSSProperties & Record<string, string> = {};
  style["--i"] = String(index);
  return style;
}

/** Name, plan, status, identity and a chip for each limit. The chip for the shown window kind is marked. */
export function WhoCell(props: { readonly lane: Lane; readonly context: TipContext }) {
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
        {status.word === "Active" ? null : <StatusPill kind={statusKindOf(status.word)} />}
      </div>
      {connection.identity === null ? null : (
        <div className="who tl-ident">{connection.identity}</div>
      )}
      <div className="tl-chips">
        {meterWindows(connection)
          .filter((meter) => !meter.unlimited)
          .map((meter) => {
            const shown =
              meter.used === null ? null : displayMeter(meter.used, context.view, context.low, 0);
            const tone = shown?.tone ?? null;
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

export function GroupHeader(props: { readonly group: LaneGroup }) {
  const { group } = props;
  return (
    <div className="tl-grp">
      <BrandMark provider={group.provider} />
      <b>{providerName(group.provider)}</b>
      <span>{plural(group.lanes.length, "Account")}</span>
    </div>
  );
}
