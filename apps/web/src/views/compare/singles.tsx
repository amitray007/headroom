import type { ReactNode } from "react";

import { BrandMark } from "../../icons.tsx";
import { providerName, statusOf } from "../../lib/labels.ts";
import { formatNumber } from "../../lib/present.ts";
import { Bar } from "../../ui/bar.tsx";
import { cx } from "../../ui/cx.ts";
import { StatusPill, statusKindOf } from "../../ui/pill.tsx";
import type { Row } from "./compare-model.ts";
import { figureOfRoom, figureOfWindow, type Figure, type Look } from "./figure.ts";
import { ResetLine } from "./parts.tsx";

/** One window or balance of a single account: the figure, its name, a thin bar and a line of words. */
function Line(props: {
  readonly figure: Figure;
  readonly name: string;
  readonly caption: ReactNode;
}) {
  const { figure, name } = props;
  if (figure.kind === "known") {
    return (
      <div className="line-row">
        <div className="top-line">
          <b>{figure.text}</b>
          <span className="window">{name}</span>
          {figure.caption === null ? null : (
            <span className={cx("tone", figure.tone)}>{figure.caption}</span>
          )}
        </div>
        <Bar
          thin
          percent={figure.fill}
          tone={figure.tone}
          valueNow={figure.used}
          label={`${name} ${figure.used}% used`}
        />
        <div className="cap">{props.caption}</div>
      </div>
    );
  }
  const words =
    figure.kind === "not_started" ? "Not Started" : figure.kind === "unlimited" ? "Unlimited" : "—";
  return (
    <div className="line-row">
      <div className="top-line">
        <b className={figure.kind === "unknown" ? "muted" : undefined}>{words}</b>
        <span className="window">{name}</span>
      </div>
      {figure.kind === "unlimited" ? null : <Bar thin unknown label={`${name} ${words}`} />}
      <div className="cap">{props.caption}</div>
    </div>
  );
}

/**
 * A provider with one account has nothing to compare, so its card is compact: the brand, the account and its
 * status, then each window as a thin bar with its figure and reset.
 */
export function SingleCard(props: { readonly row: Row; readonly look: Look }) {
  const { row, look } = props;
  const { connection } = row;
  const provider = connection.provider;
  const kind = connection.snapshot === null ? "waiting" : statusKindOf(statusOf(connection).word);
  return (
    <article className={cx("cmp-single", row.inactive && "dim")}>
      <header>
        <BrandMark provider={provider} size={24} />
        <span className="titles">
          <span className="pname">{providerName(provider)}</span>
          <span className="sub">
            {row.name}
            {row.plan === null ? null : ` · ${row.plan}`}
          </span>
        </span>
        <StatusPill kind={kind} />
      </header>
      <div className="rows">
        {row.windows.map((window) => (
          <Line
            key={window.key}
            figure={figureOfWindow(window, provider, look)}
            name={window.window === null ? window.label : `${window.label} · ${window.window}`}
            caption={<ResetLine window={window} />}
          />
        ))}
        {row.balance === null ? null : (
          <Line
            figure={
              row.balance.total === null || row.room.left === null
                ? { kind: "unknown" }
                : figureOfRoom(row.room.left, provider, look)
            }
            name="Credit Balance"
            caption={
              row.balance.total === null
                ? `${formatNumber(row.balance.value, row.balance.decimals)} credits left`
                : `${formatNumber(row.balance.value, row.balance.decimals)} of ${formatNumber(row.balance.total, row.balance.decimals)} left`
            }
          />
        )}
        {row.windows.length === 0 && row.balance === null ? (
          <p className="none">Nothing reported yet.</p>
        ) : null}
      </div>
    </article>
  );
}
