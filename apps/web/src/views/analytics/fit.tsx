import { shortDate } from "@headroom/view-model/time";
import { useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";

import { BrandMark } from "../../icons.tsx";
import { cx } from "../../ui/cx.ts";
import { InfoTip } from "../../ui/info-tip.tsx";
import {
  AccountLabel,
  CardTop,
  FullName,
  hour,
  Legend,
  Swatch,
  useHeadline,
  useTipLayer,
  useStoredView,
  useWidth,
  ViewCard,
} from "./common.tsx";
import { dollars } from "./format.ts";
import { hourOfWeek, usedAt, type AccountSeries, type Series } from "./series.ts";
import "./fit.css";

/**
 * Plan Fit (mockup): what each plan did over 90 days, and the few changes worth making.
 * History shows every window of every account. Actions turns that into ranked decisions, each in its own unit:
 * hours of blocked work, or dollars a month. The two units are never combined.
 */

type View = "actions" | "history";
const views = [
  { value: "history", label: "History" },
  { value: "actions", label: "Actions" },
] as const;

/** Verdict thresholds. */
const HIT_SHARE = 0.3; // share of windows at the limit that makes a plan too small
const ROOM_AVG = 45; // average peak under this, with no heavy locking, means room to spare

/** Action thresholds. */
const MIN_BLOCKED_HOURS = 8; // locked working hours in 30 days before a change is worth making
const SIBLING_ROOM_MAX = 80; // a sibling takes work only if it stayed under this while the account was locked
const SIBLING_AVG_MAX = 70; // and its average peak is under this
const DOWNSIZE_AVG = 45;
const DOWNSIZE_PRICE = 50; // dollars a month
const CANCEL_AVG = 25;
/** A plan whose busiest window came this close to the limit is never called too big. */
const DOWNSIZE_MAX_PEAK = 90;

/** Complete windows an account needs before a plan is called too small or too big. */
const MIN_WINDOWS = 2;

const spanMs = 90 * 24 * hour;
const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const verdicts = [
  { glyph: "↑", word: "Too small" },
  { glyph: "✓", word: "Fits" },
  { glyph: "↓", word: "Room to spare" },
  { glyph: "·", word: "Not enough history yet" },
] as const;
type VerdictIndex = 0 | 1 | 2 | 3;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function money(value: number): string {
  return dollars(Math.round(value));
}

// ---------------------------------------------------------------- history

interface Cell {
  readonly start: number;
  readonly end: number;
  readonly peak: number;
  readonly hours: number;
  readonly hit: boolean;
}

interface History {
  readonly account: AccountSeries;
  readonly unit: "week" | "month" | "window";
  readonly cells: readonly Cell[];
  readonly hits: number;
  readonly average: number;
  readonly highest: number;
  readonly locked: number;
  /** Dollars a month left unused at the average peak. Null when the account has no price. */
  readonly unused: number | null;
  readonly verdict: VerdictIndex;
}

function historyOf(account: AccountSeries, now: number): History | null {
  const limit = account.story.primary;
  const cells = limit.past
    .filter((window) => window.end > now - spanMs && window.end <= now)
    .map((window) => ({
      start: window.start,
      end: window.end,
      peak: Math.round(window.peak),
      hours: window.hoursAtLimit,
      hit: window.limitHitAt !== null || window.peak >= 100,
    }));
  if (cells.length === 0) return null;
  const hits = cells.filter((cell) => cell.hit).length;
  const average = Math.round(cells.reduce((total, cell) => total + cell.peak, 0) / cells.length);
  const cost = account.story.monthlyCost;
  const verdict: VerdictIndex =
    cells.length < MIN_WINDOWS
      ? 3
      : hits / cells.length >= HIT_SHARE
        ? 0
        : average < ROOM_AVG
          ? 2
          : 1;
  return {
    account,
    unit: limit.kind === "weekly" ? "week" : limit.kind === "cycle" ? "month" : "window",
    cells,
    hits,
    average,
    highest: Math.max(...cells.map((cell) => cell.peak)),
    locked: Math.round(cells.reduce((total, cell) => total + cell.hours, 0)),
    unused: cost === null ? null : (cost * (100 - average)) / 100,
    verdict,
  };
}

function compareHistory(a: History, b: History): number {
  return b.hits - a.hits || b.average - a.average || a.account.label.localeCompare(b.account.label);
}

function Verdict(props: { readonly verdict: VerdictIndex }) {
  const verdict = verdicts[props.verdict];
  return (
    <span className="fit-verdict" data-v={props.verdict}>
      <span aria-hidden="true">{verdict.glyph}</span> {verdict.word}
    </span>
  );
}

/** The one floating layer, placed in the coordinates of the wrapper it is attached to. */
function useTip(ref: RefObject<HTMLDivElement | null>) {
  const width = useWidth(ref);
  const tip = useTipLayer();
  const show = (event: PointerEvent, title: string, body: string): void => {
    tip.show(event.clientX, event.clientY, title, body);
  };
  const hide = tip.hide;
  const layer = tip.node;
  return { width, show, hide, layer };
}

function Tile(props: {
  readonly label: string;
  readonly value: string;
  readonly small?: string;
  readonly caption?: string;
}) {
  return (
    <div className="fit-tile">
      <span className="fit-tile-l">{props.label}</span>
      <span className="fit-tile-v">
        {props.value}
        {props.small === undefined ? null : <small>{props.small}</small>}
      </span>
      {props.caption === undefined ? null : <span className="fit-tile-c">{props.caption}</span>}
    </div>
  );
}

function observation(history: History): string {
  const { hits, cells, unit, average, highest, locked } = history;
  if (history.verdict === 0) {
    return `Hit the limit in ${hits} of ${cells.length} ${unit}s. A bigger plan would have avoided ~${locked} locked hours.`;
  }
  if (history.verdict === 2) {
    return `Peaks averaged ${average}%. Highest: ${highest}%. A smaller plan could cover this, if one exists.`;
  }
  return `Peaks averaged ${average}%. Hit the limit in ${hits} of ${cells.length} ${unit}s. The size fits.`;
}

/** Peak per window as columns: danger where it hit the limit, a dashed average, the limit line, the current window outlined. */
function PeakColumns(props: {
  readonly history: History;
  readonly now: number;
  readonly width: number;
}) {
  const { history, now, width } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const tip = useTip(wrap);
  const limit = history.account.story.primary;
  const right = Math.min(96, Math.max(60, width * 0.28));
  const top = 16;
  const plotHeight = 100;
  const bottom = 22;
  const base = top + plotHeight;
  const plotWidth = width - right;
  const columns = [
    ...history.cells.map((cell) => ({ ...cell, current: false })),
    {
      start: limit.start,
      end: now,
      peak: Math.round(limit.used),
      hours: 0,
      hit: false,
      current: true,
    },
  ];
  const slot = plotWidth / columns.length;
  const columnWidth = Math.min(slot - 3, 24);
  const y = (percent: number): number => base - (percent / 100) * plotHeight;
  const averageLabel = Math.max(y(history.average) + 4, y(100) + 17);
  const unit = history.unit;
  return (
    <div className="fit-cols" ref={wrap}>
      {width > 0 ? (
        <svg
          width={width}
          height={base + bottom}
          aria-label={`Peak per ${unit} for ${history.account.label}`}
        >
          <line className="fit-limit" x1={0} x2={plotWidth} y1={y(100)} y2={y(100)} />
          <text className="fit-t" x={plotWidth + 6} y={y(100) + 4}>
            Limit
          </text>
          <line className="fit-base" x1={0} x2={plotWidth} y1={base} y2={base} />
          {columns.map((column, index) => {
            const x = index * slot + slot / 2 - columnWidth / 2;
            const height = Math.max(1.5, (column.peak / 100) * plotHeight);
            return (
              <g key={column.start}>
                {column.current ? (
                  <rect
                    className="fit-col-now"
                    x={x + 0.5}
                    y={base - height + 0.5}
                    width={columnWidth - 1}
                    height={height - 1}
                    rx={2}
                  />
                ) : (
                  <rect
                    className="fit-col"
                    data-hit={column.hit || undefined}
                    x={x}
                    y={base - height}
                    width={columnWidth}
                    height={height}
                    rx={2}
                  />
                )}
                <rect
                  className="fit-hit"
                  x={index * slot}
                  y={top - 4}
                  width={slot}
                  height={plotHeight + bottom + 4}
                  onPointerMove={(event) =>
                    tip.show(
                      event,
                      column.current
                        ? `This ${unit}`
                        : `${shortDate(column.start)} to ${shortDate(column.end - 24 * hour)}`,
                      column.current
                        ? `${shortDate(column.start)} to now, ${column.peak}% used`
                        : `Peak ${column.peak}%${column.hit ? `, locked ${Math.round(column.hours)} h` : ", never locked"}`,
                    )
                  }
                  onPointerLeave={tip.hide}
                />
              </g>
            );
          })}
          <line
            className="fit-avg"
            x1={0}
            x2={plotWidth}
            y1={y(history.average)}
            y2={y(history.average)}
          />
          <text className="fit-t strong" x={plotWidth + 6} y={averageLabel}>
            Average {history.average}%
          </text>
          <text className="fit-t small" x={0} y={base + 15}>
            {shortDate(columns[0]?.start ?? now)}
          </text>
          <text
            className="fit-t small strong"
            x={plotWidth - slot / 2}
            y={base + 15}
            textAnchor="middle"
          >
            now
          </text>
        </svg>
      ) : null}
      {tip.layer}
    </div>
  );
}

/** One account's detail: verdict, four tiles, the peak chart and one plain sentence. */
function HistoryPanel(props: {
  readonly history: History;
  readonly now: number;
  readonly wide?: boolean;
}) {
  const { history } = props;
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const cost = history.account.story.monthlyCost;
  const unit = history.unit;
  return (
    <div className={cx("fit-panel", props.wide === true && "wide")} ref={ref}>
      <div className="fit-head">
        <BrandMark provider={history.account.story.provider} size={24} />
        <div className="fit-id">
          <FullName className="fit-id-name" name={history.account.label} />
          <span>{cost === null ? "Price not set" : `${dollars(cost)} a month`}</span>
        </div>
        <Verdict verdict={history.verdict} />
      </div>
      <div className="fit-tiles">
        <Tile label="Average peak" value={`${history.average}%`} />
        <Tile
          label="At the limit"
          value={String(history.hits)}
          small={`of ${history.cells.length} ${unit}s`}
        />
        <Tile
          label="Locked"
          value={history.locked > 0 ? `${history.locked} h` : "None"}
          small="in 90 days"
        />
        {history.unused === null ? (
          <Tile label="Unused" value="Unknown" small="no price set" />
        ) : (
          <Tile label="Unused" value={`~${money(history.unused)}`} small="a month, estimate" />
        )}
      </div>
      <p className="fit-sec">
        <b>Peak per {unit}</b> · last 90 days
      </p>
      <PeakColumns history={history} now={props.now} width={width} />
      <Legend>
        <span>
          <Swatch kind="ramp" level={2} />
          Peak
        </span>
        <span>
          <i className="fit-sw-hit" aria-hidden="true" />
          Hit the limit
        </span>
        <span>
          <i className="fit-sw-now" aria-hidden="true" />
          Now
        </span>
        <span>
          <Swatch kind="dash" />
          Average
        </span>
      </Legend>
      <p className="fit-obs">{observation(history)}</p>
    </div>
  );
}

function monthStarts(from: number, to: number): number[] {
  const out: number[] = [];
  const start = new Date(from);
  let month = start.getFullYear() * 12 + start.getMonth() + 1;
  for (;;) {
    const at = new Date(Math.floor(month / 12), month % 12, 1).getTime();
    if (at > to) return out;
    out.push(at);
    month += 1;
  }
}

function shadeOf(peak: number): 0 | 1 | 2 | 3 {
  return peak < 40 ? 0 : peak < 60 ? 1 : peak < 80 ? 2 : 3;
}

function HistoryGrid(props: {
  readonly rows: readonly History[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
  readonly now: number;
  readonly onHover: (line: { readonly big: string; readonly cap: string } | null) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const tip = useTip(wrap);
  const axis = useRef<HTMLDivElement>(null);
  const plotWidth = useWidth(axis);
  const from = props.now - spanMs;
  const x = (at: number): number => ((at - from) / spanMs) * plotWidth;
  const months = monthStarts(from, props.now);
  // Rows may grow to fill the column beside the panel, so the SVG is drawn in percentages of its own height.
  const cellShare = 0.56;
  const cellTop = `${((1 - cellShare) / 2) * 100}%`;
  const cellSize = `${cellShare * 100}%`;
  return (
    <div
      className="fit-grid"
      ref={wrap}
      data-narrow={tip.width > 0 && tip.width < 560 ? "" : undefined}
    >
      <div className="fit-row head" aria-hidden="true">
        <span />
        <div className="fit-plot" ref={axis}>
          {plotWidth > 0 ? (
            <svg width={plotWidth} height={18}>
              {months.map((at) => (
                <text key={at} className="fit-t" x={x(at) + 4} y={12}>
                  {monthNames[new Date(at).getMonth()]}
                </text>
              ))}
            </svg>
          ) : null}
        </div>
        <span />
      </div>
      {props.rows.map((history) => {
        const account = history.account;
        const limit = account.story.primary;
        const nowStart = Math.max(from, limit.start);
        const nowWidth = Math.max(2, x(props.now) - x(nowStart) - 1);
        const level = Math.round(limit.used);
        const fillShare = Math.max(0.03, (level / 100) * cellShare);
        const sub = `${level}% used`;
        return (
          <button
            key={account.id}
            type="button"
            className="fit-row"
            aria-pressed={props.selected === account.id}
            aria-label={`${account.label}: ${verdicts[history.verdict].word}. Show details`}
            onClick={() => props.onSelect(account.id)}
            onPointerEnter={() => props.onHover(summaryLine(history))}
            onPointerLeave={() => props.onHover(null)}
          >
            <AccountLabel account={account} strong={props.selected === account.id} />
            <div className="fit-plot">
              {plotWidth > 0 ? (
                <svg className="fit-row-svg" width={plotWidth} aria-hidden="true">
                  {months.map((at) => (
                    <line key={at} className="fit-month" x1={x(at)} x2={x(at)} y1={0} y2="100%" />
                  ))}
                  {history.cells.map((cell) => {
                    const xa = x(Math.max(cell.start, from)) + 1;
                    const xb = x(Math.min(cell.end, props.now)) - 1;
                    const title = `${account.label} · ${history.unit} of ${shortDate(cell.start)}`;
                    const body = `Peak ${cell.peak}%${cell.hit ? `, locked ${Math.round(cell.hours)} h` : ""}`;
                    return (
                      <rect
                        key={cell.start}
                        className="fit-cell"
                        data-hit={cell.hit || undefined}
                        data-shade={shadeOf(cell.peak)}
                        x={xa}
                        y={cellTop}
                        width={Math.max(2, xb - xa)}
                        height={cellSize}
                        rx={3}
                        onPointerMove={(event) => {
                          tip.show(event, title, body);
                          props.onHover({ big: title, cap: body });
                        }}
                        onPointerLeave={tip.hide}
                      />
                    );
                  })}
                  <g
                    onPointerMove={(event) => {
                      tip.show(event, `${account.label} · current ${history.unit}`, sub);
                      props.onHover({
                        big: `${account.label} · current ${history.unit} since ${shortDate(limit.start)}`,
                        cap: sub,
                      });
                    }}
                    onPointerLeave={tip.hide}
                  >
                    <rect
                      className="fit-cell-now"
                      x={x(nowStart) + 1}
                      y={cellTop}
                      width={nowWidth}
                      height={cellSize}
                      rx={3}
                    />
                    <rect
                      className="fit-cell"
                      data-shade={shadeOf(level)}
                      x={x(nowStart) + 2}
                      y={`${((1 + cellShare) / 2 - fillShare) * 100}%`}
                      width={Math.max(1, nowWidth - 2)}
                      height={`${fillShare * 100}%`}
                      rx={2}
                    />
                  </g>
                </svg>
              ) : null}
            </div>
            <Verdict verdict={history.verdict} />
          </button>
        );
      })}
      {tip.layer}
    </div>
  );
}

function summaryLine(history: History): { readonly big: string; readonly cap: string } {
  const label = history.account.label;
  const unit = history.unit;
  if (history.verdict === 3) {
    return {
      big: `${label}: not enough history yet`,
      cap: `Needs ${MIN_WINDOWS} complete ${unit}s to judge the plan`,
    };
  }
  const unused =
    history.unused === null
      ? "price not set"
      : `~${money(history.unused)} of ${dollars(history.account.story.monthlyCost ?? 0)} a month unused (est.)`;
  return {
    big:
      history.hits > 0
        ? `${label} hit the limit in ${history.hits} of ${history.cells.length} ${unit}s`
        : `${label} never hit the limit in ${history.cells.length} ${unit}s`,
    cap: `Average peak ${history.average}%, locked ${history.locked} h, ${unused}`,
  };
}

function HistoryView(props: {
  readonly rows: readonly History[];
  readonly now: number;
  readonly picked: string | null;
  readonly onPick: (id: string) => void;
}) {
  const picked = props.picked;
  const first = props.rows[0];
  const match = props.rows.find((row) => row.account.id === picked);
  // A picked id with no row must not highlight another account: show the first row, unpicked.
  const selected = match ?? first;
  const small = props.rows.filter((row) => row.verdict === 0).length;
  const room = props.rows.filter((row) => row.verdict === 2).length;
  const worst = first;
  const judged = props.rows.some((row) => row.verdict !== 3);
  const base = !judged
    ? {
        big: "Not enough history yet",
        cap: `Plan Fit needs ${MIN_WINDOWS} complete windows of an account`,
      }
    : {
        big: `${plural(small, "plan")} ${small === 1 ? "is" : "are"} too small, ${room} ${room === 1 ? "has" : "have"} room to spare`,
        cap:
          worst === undefined || worst.hits === 0
            ? "No account hit its limit in 90 days"
            : `${worst.account.label} hit the limit in ${worst.hits} of ${worst.cells.length} ${worst.unit}s`,
      };
  const headline = useHeadline(base);
  if (selected === undefined) return <p className="fit-empty">No closed windows in 90 days.</p>;
  return (
    <div className="fit-history">
      <CardTop headline={headline.node} />
      <div className="an2-split fit-split">
        <div className="fit-main">
          <HistoryGrid
            rows={props.rows}
            selected={selected.account.id}
            onSelect={props.onPick}
            now={props.now}
            onHover={(line) => (line === null ? headline.clear() : headline.show(line))}
          />
          <Legend>
            <span>
              <Swatch kind="ramp" level={0} />
              <Swatch kind="ramp" level={1} />
              <Swatch kind="ramp" level={2} />
              <Swatch kind="ramp" level={3} />
              Peak: under 40, 40-60, 60-80, 80-99%
            </span>
            <span>
              <i className="fit-sw-hit" aria-hidden="true" />
              Hit the limit
            </span>
            <span>
              <i className="fit-sw-cur" aria-hidden="true" />
              Current window
            </span>
            <span>One cell per window. Width is its length.</span>
          </Legend>
        </div>
        <aside className="an2-panel">
          <HistoryPanel history={selected} now={props.now} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- actions

type Kind = "move" | "upgrade" | "down";

interface Action {
  readonly id: string;
  readonly kind: Kind;
  readonly account: AccountSeries;
  readonly sibling: AccountSeries | null;
  /** The sibling's highest use while the account was locked in working hours. */
  readonly siblingMax: number | null;
  readonly blocked: number;
  /** Dollars a month; null when unknown. */
  readonly money: number | null;
  readonly verb: string;
  readonly glyph: string;
  readonly title: string;
  readonly why: string;
  /** The highest peak of any window; set for downsize and cancel. */
  readonly highest: number | null;
  /** Monthly price of the account if this move would let you drop it. */
  readonly drop: number | null;
}

interface Fits {
  readonly account: AccountSeries;
  readonly reason: string;
}

interface Plan {
  readonly actions: readonly Action[];
  readonly keep: readonly Fits[];
  readonly freed: number;
  readonly saved: number;
}

const workName = (account: AccountSeries): boolean =>
  account.story.name === "Team" || account.story.name === "Work";

function lockedWorkSlots(series: Series, account: AccountSeries): number[] {
  const slots: number[] = [];
  account.locked.forEach((locked, slot) => {
    if (locked && series.working[hourOfWeek(series.from + slot * hour)] === true) slots.push(slot);
  });
  return slots;
}

function planOf(series: Series): Plan {
  const active = series.accounts.filter((account) => !account.story.inactive);
  const actions: Action[] = [];
  const keep: Fits[] = [];
  for (const account of active) {
    const story = account.story;
    const average = story.primary.averagePeak;
    const slots = lockedWorkSlots(series, account);
    if (average === null || story.primary.past.length < MIN_WINDOWS) {
      keep.push({ account, reason: "Not enough history yet." });
      continue;
    }
    const cost = story.monthlyCost;
    const unused = cost === null ? null : (cost * (100 - average)) / 100;
    const base = { id: account.id, account };
    if (slots.length >= MIN_BLOCKED_HOURS) {
      const siblings = active
        .filter((other) => other !== account && other.story.provider === story.provider)
        .map((other) => {
          const values = slots
            .map((slot) => usedAt(other, series.from + slot * hour))
            .filter((value): value is number => value !== null);
          return { other, max: values.length === 0 ? null : Math.max(...values) };
        })
        .filter((entry): entry is { other: AccountSeries; max: number } => entry.max !== null);
      const room = siblings
        .filter(
          (entry) =>
            entry.max < SIBLING_ROOM_MAX &&
            (entry.other.story.primary.averagePeak ?? 100) < SIBLING_AVG_MAX,
        )
        .toSorted((a, b) => a.max - b.max)[0];
      const check = workName(account) || (room !== undefined && workName(room.other));
      if (room !== undefined) {
        const target = room.other;
        const targetCost = target.story.monthlyCost;
        const targetUnused =
          targetCost === null
            ? null
            : (targetCost * (100 - (target.story.primary.averagePeak ?? 0))) / 100;
        const cheap = cost !== null && cost <= 20 && targetCost !== null && targetCost > cost;
        actions.push({
          ...base,
          kind: "move",
          sibling: target,
          siblingMax: room.max,
          blocked: slots.length,
          money: null,
          highest: null,
          drop: cheap ? cost : null,
          verb: "Move work",
          glyph: "→",
          title: `Move work from ${account.label} to ${target.label}`,
          why: [
            `${target.label} stayed under ${Math.round(room.max)}% while ${account.label} was locked${
              targetUnused === null ? "." : `. It leaves ~${money(targetUnused)} a month unused.`
            }`,
            cheap ? `You could drop ${account.label} (${money(cost)} a month).` : "",
            check ? "Check first that this work may run there." : "",
          ]
            .filter(Boolean)
            .join(" "),
        });
      } else {
        const full = siblings.toSorted((a, b) => b.max - a.max)[0];
        const fullAverage = full?.other.story.primary.averagePeak ?? null;
        actions.push({
          ...base,
          kind: "upgrade",
          sibling: full?.other ?? null,
          siblingMax: full?.max ?? null,
          blocked: slots.length,
          money: null,
          highest: null,
          drop: null,
          verb: "Upgrade",
          glyph: "↑",
          title: `Upgrade ${account.label}`,
          why:
            full === undefined
              ? `No other ${story.providerName} account can take the work.`
              : fullAverage !== null && fullAverage >= SIBLING_AVG_MAX
                ? `${full.other.label} averages ${Math.round(fullAverage)}% of its limit. Little room for this work.`
                : `${full.other.label} was at ${Math.round(full.max)}% too.`,
        });
      }
    } else if (
      average < DOWNSIZE_AVG &&
      Math.max(story.primary.used, ...story.primary.past.map((w) => w.peak)) < DOWNSIZE_MAX_PEAK &&
      ((cost !== null && cost >= DOWNSIZE_PRICE) || average < CANCEL_AVG)
    ) {
      const cancel = average < CANCEL_AVG;
      const unit = story.primary.kind === "cycle" ? "month" : "week";
      const highest = Math.round(
        Math.max(story.primary.used, ...story.primary.past.map((w) => w.peak)),
      );
      actions.push({
        ...base,
        kind: "down",
        sibling: null,
        siblingMax: null,
        blocked: 0,
        money: unused,
        highest,
        drop: null,
        verb: cancel ? "Cancel?" : "Downsize",
        glyph: cancel ? "×" : "↓",
        title: `${cancel ? "Downsize or cancel" : "Downsize"} ${account.label}`,
        why: `Highest ${unit}: ${highest}%. Never near the limit.${
          story.name === "Work" ? " Work account: check who pays." : ""
        }`,
      });
    } else {
      keep.push({
        account,
        reason: `Averages ${Math.round(average)}%. ${
          slots.length > 0 ? `Only ${slots.length} h blocked.` : "Never blocked."
        }`,
      });
    }
  }
  // An account that should take another's work keeps its room: never also suggest shrinking it.
  const targets = new Set(
    actions.flatMap((action) =>
      action.kind === "move" && action.sibling !== null ? [action.sibling.id] : [],
    ),
  );
  for (const action of actions.filter(
    (entry) => entry.kind === "down" && targets.has(entry.account.id),
  )) {
    actions.splice(actions.indexOf(action), 1);
    const source = actions.find(
      (entry) => entry.kind === "move" && entry.sibling?.id === action.account.id,
    );
    keep.push({
      account: action.account,
      reason: `Averages ${averageOf(action.account)}%. Can take ${source?.account.label ?? "other"} work.`,
    });
  }
  // Blocked hours first, then money. Units are never combined.
  actions.sort(
    (a, b) =>
      Number(b.blocked > 0) - Number(a.blocked > 0) ||
      (a.blocked > 0 ? b.blocked - a.blocked : (b.money ?? -1) - (a.money ?? -1)),
  );
  return {
    actions,
    keep,
    freed: actions.reduce((total, action) => total + action.blocked, 0),
    saved: Math.round(actions.reduce((total, action) => total + (action.money ?? 0), 0)),
  };
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value));
const averageOf = (account: AccountSeries): number =>
  Math.round(account.story.primary.averagePeak ?? 0);

/** A thin bar: 100% is the limit. A tick marks a highest peak. */
function Meter(props: {
  readonly percent: number;
  readonly tone: "danger" | "grey";
  readonly tick?: number | undefined;
}) {
  return (
    <span className="fit-meter" aria-hidden="true">
      <i data-tone={props.tone} style={{ width: `${clamp(props.percent)}%` }} />
      {props.tick === undefined ? null : <b style={{ left: `${clamp(props.tick)}%` }} />}
    </span>
  );
}

function MeterLine(props: {
  readonly account: AccountSeries;
  readonly percent: number;
  readonly tone: "danger" | "grey";
  readonly tick?: number | undefined;
  readonly text: string;
  readonly arrow?: boolean;
}) {
  return (
    <div className="fit-line">
      <span className="fit-line-arrow" aria-hidden="true">
        {props.arrow === true ? "→" : ""}
      </span>
      <BrandMark provider={props.account.story.provider} />
      <FullName className="fit-line-name" name={props.account.label} />
      <Meter percent={props.percent} tone={props.tone} tick={props.tick} />
      <span className="fit-line-text">{props.text}</span>
    </div>
  );
}

function Lines(props: { readonly action: Action }) {
  const { action } = props;
  const sibling = action.sibling;
  if (action.kind === "move") {
    const peak = Math.round(action.siblingMax ?? 0);
    return (
      <>
        <MeterLine
          account={action.account}
          percent={100}
          tone="danger"
          text={`Locked ${action.blocked} h in work hours`}
        />
        {sibling === null ? null : (
          <MeterLine
            account={sibling}
            percent={peak}
            tone="grey"
            text={`Peaked ${peak}% meanwhile`}
            arrow
          />
        )}
        {action.drop === null ? null : (
          <p className="fit-note-line">
            Could then drop {action.account.label} · {money(action.drop)} a month
          </p>
        )}
      </>
    );
  }
  if (action.kind === "upgrade") {
    const roomy = sibling !== null && averageOf(sibling) < SIBLING_AVG_MAX;
    return (
      <>
        <MeterLine
          account={action.account}
          percent={100}
          tone="danger"
          text={`Locked ${action.blocked} h in work hours`}
        />
        {sibling === null ? (
          <p className="fit-note-line">No other {action.account.story.providerName} account</p>
        ) : roomy ? (
          <MeterLine
            account={sibling}
            percent={Math.round(action.siblingMax ?? 0)}
            tone="grey"
            text={`Peaked ${Math.round(action.siblingMax ?? 0)}% meanwhile`}
          />
        ) : (
          <MeterLine
            account={sibling}
            percent={averageOf(sibling)}
            tone="grey"
            text={`Averages ${averageOf(sibling)}%, no room`}
          />
        )}
      </>
    );
  }
  const highest = Math.round(action.highest ?? 0);
  return (
    <MeterLine
      account={action.account}
      percent={averageOf(action.account)}
      tone="grey"
      tick={highest}
      text={`Averages ${averageOf(action.account)}% · highest ${highest}%`}
    />
  );
}

function Impact(props: { readonly action: Action }) {
  const { action } = props;
  if (action.blocked > 0) {
    return (
      <span className="fit-imp blk">
        {action.blocked}
        <small>h unblocked</small>
      </span>
    );
  }
  if (action.money === null) {
    return (
      <span className="fit-imp unknown">
        Unknown<small>price not set</small>
      </span>
    );
  }
  return (
    <span className="fit-imp">
      ~{money(action.money)}
      <small>a month</small>
    </span>
  );
}

function ActionRow(props: {
  readonly action: Action;
  readonly onHover: (line: { readonly big: string; readonly cap: string } | null) => void;
  readonly onOpenHistory: (id: string) => void;
  /** Ids that have a History row; accounts without one get no History button. */
  readonly hasHistory: (id: string) => boolean;
}) {
  const { action } = props;
  return (
    <div
      className="fit-act"
      onPointerEnter={() => props.onHover({ big: action.title, cap: action.why })}
      onPointerLeave={() => props.onHover(null)}
    >
      <span className="fit-verb">
        <span className="fit-glyph" aria-hidden="true">
          {action.glyph}
        </span>
        {action.verb}
      </span>
      <div className="fit-lines">
        <Lines action={action} />
      </div>
      <div className="fit-end">
        <Impact action={action} />
        {props.hasHistory(action.account.id) ? (
          <button
            type="button"
            className="fit-link"
            aria-label={`History of ${action.account.label}`}
            onClick={() => props.onOpenHistory(action.account.id)}
          >
            History
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SectionHead(props: {
  readonly title: string;
  readonly total: string;
  /** One line on how the total is counted, shown in an info tip beside the title. */
  readonly info?: string;
}) {
  return (
    <div className="fit-sh">
      <span className="fit-sh-t">
        {props.title}
        {props.info === undefined ? null : (
          <InfoTip label={`How ${props.title.toLowerCase()} is counted`}>
            <b>{props.title}</b>
            {props.info}
          </InfoTip>
        )}
      </span>
      <span className="fit-sh-v">{props.total}</span>
    </div>
  );
}

function ActionsView(props: {
  readonly series: Series;
  readonly onOpenHistory: (id: string) => void;
  /** Ids that have a History row; accounts without one get no History button. */
  readonly hasHistory: (id: string) => boolean;
}) {
  const plan = planOf(props.series);
  const [keepOpen, setKeepOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const unblock = plan.actions
    .filter((action) => action.kind !== "down")
    .toSorted((a, b) => b.blocked - a.blocked);
  const save = plan.actions
    .filter((action) => action.kind === "down")
    .toSorted((a, b) => (b.money ?? -1) - (a.money ?? -1));
  const parts = [
    plan.freed > 0 ? `Free ${plan.freed} h of blocked work` : "",
    plan.saved > 0 ? `${plan.freed > 0 ? "save" : "Save"} ~${money(plan.saved)} a month` : "",
  ].filter(Boolean);
  const base =
    plan.actions.length === 0
      ? { big: "No changes worth making", cap: "Every plan fits your work" }
      : {
          big: `${plural(plan.actions.length, "change")} worth making`,
          cap: parts.length === 0 ? "Review each one below" : parts.join(" · "),
        };
  const headline = useHeadline(base);
  const hover = (line: { readonly big: string; readonly cap: string } | null): void =>
    line === null ? headline.clear() : headline.show(line);
  const section = (
    title: string,
    total: string,
    info: string,
    rows: readonly Action[],
  ): ReactNode =>
    rows.length === 0 ? null : (
      <section className="fit-sec-block">
        <SectionHead title={title} total={total} info={info} />
        {rows.map((action) => (
          <ActionRow
            key={action.id}
            action={action}
            onHover={hover}
            onOpenHistory={props.onOpenHistory}
            hasHistory={props.hasHistory}
          />
        ))}
      </section>
    );
  return (
    <div
      className="fit-actions"
      ref={ref}
      data-narrow={width > 0 && width < 640 ? "" : undefined}
      data-tight={width >= 640 && width < 860 ? "" : undefined}
    >
      <CardTop headline={headline.node} />
      {section(
        "Unblock work",
        `${plan.freed} h in 30 days`,
        "Hours a limit was locked while you usually work.",
        unblock,
      )}
      {section(
        "Save money",
        `~${money(plan.saved)} a month`,
        "An estimate: the price times the share of the limit you leave unused.",
        save,
      )}
      {plan.keep.length > 0 ? (
        <KeepSection
          keep={plan.keep}
          open={keepOpen}
          onToggle={() => setKeepOpen((value) => !value)}
          onOpenHistory={props.onOpenHistory}
          hasHistory={props.hasHistory}
        />
      ) : null}
    </div>
  );
}

/** Plans that need no change: a collapsed row that opens into the same meter lines as the actions above. */
function KeepSection(props: {
  readonly keep: readonly Fits[];
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onOpenHistory: (id: string) => void;
  /** Ids that have a History row; accounts without one get no History button. */
  readonly hasHistory: (id: string) => boolean;
}): ReactNode {
  return (
    <section className="fit-sec-block">
      <button
        type="button"
        className="fit-disclose"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        <svg className="fit-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M4 2.5 7.5 6 4 9.5" />
        </svg>
        <span className="fit-sh-t">Keep</span>
        <span className="fit-disclose-hint">No change needed</span>
        <span className="fit-sh-v">{plural(props.keep.length, "account")}</span>
      </button>
      {props.open
        ? props.keep.map((entry) => {
            const peaks = entry.account.story.primary.past.map((window) => window.peak);
            const highest = Math.max(entry.account.story.primary.used, ...peaks);
            return (
              <div key={entry.account.id} className="fit-act fit-keep-row">
                {/* No verb: the rows sit under "Keep", and their meters line up with the actions above. */}
                <span />
                <div className="fit-lines">
                  <MeterLine
                    account={entry.account}
                    percent={averageOf(entry.account)}
                    tone="grey"
                    tick={highest}
                    text={entry.reason}
                  />
                </div>
                <div className="fit-end">
                  {props.hasHistory(entry.account.id) ? (
                    <button
                      type="button"
                      className="fit-link"
                      aria-label={`History of ${entry.account.label}`}
                      onClick={() => props.onOpenHistory(entry.account.id)}
                    >
                      History
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        : null}
    </section>
  );
}

export function PlanFitCard(props: { readonly series: Series }) {
  const [view, setView] = useStoredView<View>("fit", ["history", "actions"], "history");
  const [picked, setPicked] = useState<string | null>(null);
  const rows = props.series.accounts
    .filter((account) => !account.story.inactive)
    .map((account) => historyOf(account, props.series.now))
    .filter((history): history is History => history !== null)
    .toSorted(compareHistory);
  return (
    <ViewCard title="Plan Fit" views={views} view={view} onView={setView}>
      {view === "actions" ? (
        <ActionsView
          series={props.series}
          hasHistory={(id) => rows.some((row) => row.account.id === id)}
          onOpenHistory={(id) => {
            setPicked(id);
            setView("history");
          }}
        />
      ) : (
        <HistoryView rows={rows} now={props.series.now} picked={picked} onPick={setPicked} />
      )}
    </ViewCard>
  );
}
