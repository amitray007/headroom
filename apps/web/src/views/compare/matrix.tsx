import { useState, type ReactNode } from "react";

import { AlertIcon, PauseIcon } from "../../icons.tsx";
import { formatNumber } from "@headroom/view-model/present";
import { When } from "../../lib/when.tsx";
import { Bar } from "../../ui/bar.tsx";
import { cx } from "../../ui/cx.ts";
import { VerifiedSeal } from "../../ui/verified-seal.tsx";
import {
  balanceKey,
  limitingName,
  slotOf,
  type Column,
  type Row,
  type Sort,
} from "./compare-model.ts";
import { figureOfRoom, figureOfWindow, type Figure, type Look } from "./figure.ts";
import { LimitTag, ResetLine } from "./parts.tsx";

function SortArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}

/** A figure, a thin bar and a line of words, in one box. `limiting` outlines the box and tags it. */
function Mini(props: {
  readonly figure: Figure;
  readonly name: string;
  readonly caption: ReactNode;
  readonly limiting?: boolean;
  readonly large?: boolean;
}) {
  const { figure, name } = props;
  const limiting = props.limiting === true;
  if (figure.kind === "known") {
    return (
      <div className={cx("cmp-mc", figure.tone, limiting && "tight", props.large === true && "lg")}>
        <div className="top-line">
          <b>{figure.text}</b>
          {limiting ? (
            <LimitTag />
          ) : figure.caption === null ? null : (
            <span className="cmp-tag">{figure.caption}</span>
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
    <div className={cx("cmp-mc", "none", props.large === true && "lg")}>
      <div className="top-line">
        <b className={figure.kind === "unknown" ? "muted" : undefined}>{words}</b>
        {limiting ? <LimitTag /> : null}
      </div>
      {figure.kind === "unlimited" ? null : <Bar thin unknown label={`${name} ${words}`} />}
      <div className="cap">{props.caption}</div>
    </div>
  );
}

function WindowCell(props: { readonly row: Row; readonly column: Column; readonly look: Look }) {
  const { row, column, look } = props;
  const provider = row.connection.provider;
  const name = column.window === null ? column.label : `${column.label} ${column.window}`;
  if (column.key === balanceKey) {
    if (row.balance === null) {
      return <Mini figure={{ kind: "unknown" }} name={name} caption="Not reported" />;
    }
    const { value, total, decimals } = row.balance;
    if (total === null || row.room.left === null) {
      return (
        <div className="cmp-mc none">
          <div className="top-line">
            <b>{formatNumber(value, decimals)}</b>
          </div>
          <div className="cap">credits left</div>
        </div>
      );
    }
    return (
      <Mini
        figure={figureOfRoom(row.room.left, provider, look)}
        name={name}
        caption={`${formatNumber(value, decimals)} of ${formatNumber(total, decimals)} left`}
      />
    );
  }
  const window = row.windows.find((entry) => slotOf(entry) === column.key);
  if (window === undefined) {
    return (
      <div className="cmp-mc none">
        <div className="top-line">
          <b className="muted">—</b>
        </div>
        <div className="cap">Not reported</div>
      </div>
    );
  }
  return (
    <Mini
      figure={figureOfWindow(window, provider, look)}
      name={name}
      caption={<ResetLine window={window} />}
      limiting={!row.inactive && row.room.limiting?.key === window.key}
    />
  );
}

function RoomCell(props: { readonly row: Row; readonly look: Look }) {
  const { row, look } = props;
  const { room } = row;
  if (row.inactive) {
    return <Mini figure={{ kind: "unknown" }} name="Room left" caption="Not counted" large />;
  }
  if (room.left === null) {
    return <Mini figure={{ kind: "unknown" }} name="Room left" caption="Not reported" large />;
  }
  if (room.unit === "credits") {
    return (
      <div className="cmp-mc none lg">
        <div className="top-line">
          <b>{formatNumber(room.left, 2)}</b>
        </div>
        <div className="cap">credits left</div>
      </div>
    );
  }
  const limited = limitingName(room);
  const unstarted = room.limiting?.notStarted === true;
  return (
    <Mini
      figure={figureOfRoom(room.left, row.connection.provider, look)}
      name="Room left"
      caption={
        unstarted
          ? "Nothing running yet"
          : limited === null
            ? "Share of everything granted"
            : `Limited by ${limited}`
      }
      large
    />
  );
}

function AccountCell(props: { readonly row: Row; readonly recommended: boolean }) {
  const { row } = props;
  const at = row.connection.lastSuccessAt;
  const paused = row.connection.state === "paused";
  return (
    <div className="cmp-acct">
      <div className="line">
        <span className="name">
          {row.name}
          {row.plan === null ? null : (
            <span className="plan">
              <span className="sep" aria-hidden="true">
                ·
              </span>
              {row.plan}
            </span>
          )}
        </span>
        {props.recommended ? <VerifiedSeal size="sm" label="Recommended right now" /> : null}
      </div>
      {row.inactive ? (
        <>
          <span className="why">
            {paused ? <PauseIcon /> : <AlertIcon />}
            {paused ? "Paused. Not counted." : "Disconnected. Not counted."}
          </span>
          {at === null ? null : (
            <span className="sub">
              <When at={at} kind="ago" prefix="Updated" />
            </span>
          )}
        </>
      ) : row.connection.identity === null ? null : (
        <span className="sub">
          <span className="who">{row.connection.identity}</span>
        </span>
      )}
    </div>
  );
}

function Header(props: {
  readonly sortKey: string;
  readonly sort: Sort;
  readonly onSort: (key: string) => void;
  readonly children: ReactNode;
}) {
  const on = props.sort.key === props.sortKey;
  const aria = on ? (props.sort.dir === "asc" ? "ascending" : "descending") : undefined;
  return (
    <th scope="col" aria-sort={aria}>
      <button className="cmp-sort" type="button" onClick={() => props.onSort(props.sortKey)}>
        {props.children}
        <SortArrow />
      </button>
    </th>
  );
}

/**
 * Accounts as rows, windows as columns. The first column stays put while the rest scroll sideways inside the card.
 * Each row's limiting window is outlined. Rows arrive already sorted.
 */
export function Matrix(props: {
  readonly rows: readonly Row[];
  readonly columns: readonly Column[];
  readonly sort: Sort;
  readonly onSort: (key: string) => void;
  readonly bestId: string | null;
  readonly look: Look;
  readonly caption: string;
}) {
  const { sort, onSort } = props;
  const [scrolled, setScrolled] = useState(false);
  return (
    <div className="cmp-card">
      <div
        className="cmp-scroll"
        onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 2)}
      >
        <table className={cx("cmp-matrix", scrolled && "scrolled")}>
          <caption className="sr">{props.caption}</caption>
          <thead>
            <tr>
              <Header sortKey="name" sort={sort} onSort={onSort}>
                <b>Account</b>
              </Header>
              <Header sortKey="room" sort={sort} onSort={onSort}>
                <b>Room Left</b>
              </Header>
              {props.columns.map((column) => (
                <Header key={column.key} sortKey={column.key} sort={sort} onSort={onSort}>
                  <b>{column.label}</b>
                  {column.window === null ? null : <span className="window">{column.window}</span>}
                </Header>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.connection.id} className={row.inactive ? "inactive" : undefined}>
                <th scope="row">
                  <AccountCell row={row} recommended={row.connection.id === props.bestId} />
                </th>
                <td className="overall">
                  <RoomCell row={row} look={props.look} />
                </td>
                {props.columns.map((column) => (
                  <td key={column.key}>
                    <WindowCell row={row} column={column} look={props.look} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
