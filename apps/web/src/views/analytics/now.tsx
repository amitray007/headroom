/* oxlint-disable jsx-a11y/prefer-tag-over-role -- an SVG chart needs role="img" with a label; <img> cannot hold the SVG marks and their hover regions */
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { shortDate } from "@headroom/view-model/time";

import { cx } from "../../ui/cx.ts";
import {
  AccountLabel,
  CardTop,
  day,
  hour,
  Legend,
  Swatch,
  useHeadline,
  useTipLayer,
  useStoredView,
  useWidth,
  ViewCard,
  type Line,
} from "./common.tsx";
import { hoursText } from "./format.ts";
import type { AccountSeries, Series } from "./series.ts";
import { slotCount } from "./series.ts";
import "./now.css";

/**
 * Right now: what runs out before its reset. A forecast grid of the next week, or a table, and the burn-down of
 * the selected account. Everything assumes the pace so far continues. Accounts that are inactive, or whose window
 * is too young to project, stay in the list muted and say why; they never count in the headline.
 */

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const blocks = 28;
const block = 6 * hour;

const pad = (value: number): string => String(value).padStart(2, "0");

/** "Thu 22:21"; a date once the weekday would be ambiguous (six days or more ahead): "Oct 24 01:17". */
function stampOf(at: number, now: number): string {
  const date = new Date(at);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${at - now >= 6 * day ? shortDate(at) : (dayNames[date.getDay()] ?? "")} ${clock}`;
}

function untilText(at: number, now: number): string {
  const hours = (at - now) / hour;
  if (hours >= 48) return `in ${Math.round(hours / 24)} days`;
  return hours >= 1 ? `in ${Math.round(hours)} h` : "soon";
}

/** One account's forecast, from its main limit. */
interface Forecast {
  readonly account: AccountSeries;
  readonly used: number;
  readonly start: number;
  readonly end: number;
  readonly elapsed: number;
  readonly projected: number | null;
  readonly runsOut: number | null;
  readonly pace: number | null;
  /** Why there is no forecast, or null. */
  readonly note: string | null;
}

function forecastOf(account: AccountSeries, now: number): Forecast {
  const limit = account.story.primary;
  // No current reading: the account needs a sign-in, its reading is out of date, or its window already reset.
  const inactive = account.story.inactive;
  const noReading = inactive || account.story.stale || limit.end <= now;
  const projected = noReading ? null : limit.projectedAtReset;
  return {
    account,
    used: limit.used,
    start: limit.start,
    end: limit.end,
    elapsed: limit.elapsedShare,
    projected,
    runsOut: noReading ? null : limit.runsOutAt,
    pace: noReading ? null : limit.pace,
    note: inactive
      ? "Reconnect to forecast"
      : noReading
        ? "No current reading"
        : projected === null
          ? "Too early to forecast"
          : null,
  };
}

const ready = (f: Forecast): boolean => f.note === null;

/** Soonest run-out first, then the highest projection. */
function attention(p: Forecast, q: Forecast): number {
  if (p.runsOut !== null && q.runsOut !== null) return p.runsOut - q.runsOut;
  if (p.runsOut !== null) return -1;
  if (q.runsOut !== null) return 1;
  return (q.projected ?? 0) - (p.projected ?? 0);
}

const lockedHours = (f: Forecast): number => (f.runsOut === null ? 0 : (f.end - f.runsOut) / hour);

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function headlineOf(rows: readonly Forecast[], now: number): Line {
  const out = rows.filter((f) => ready(f) && f.runsOut !== null).toSorted(attention);
  const first = out[0];
  if (first === undefined || first.runsOut === null) {
    return {
      big: "Nothing runs out before reset",
      cap: "Every forecast account resets with room to spare",
    };
  }
  return {
    big: `${plural(out.length, "account runs", "accounts run")} out before reset`,
    cap: `${first.account.label} first, ${stampOf(first.runsOut, now)}, then locked ${hoursText(lockedHours(first))}`,
  };
}

/** The line a row shows in the headline while the pointer rests on it. */
function rowCaption(f: Forecast, now: number): string {
  if (f.note !== null) return f.note;
  return `${outcome(f, now)} · used ${Math.round(f.used)}%`;
}

function outcome(f: Forecast, now: number): string {
  // Past six days the hour adds nothing to a row; the panel still gives the full time.
  if (f.runsOut !== null)
    return `Runs out ${f.runsOut - now >= 6 * day ? shortDate(f.runsOut) : stampOf(f.runsOut, now)}`;
  if (f.used >= 100) return "At the limit";
  return `~${Math.round(f.projected ?? 0)}% at reset`;
}

interface TipApi {
  readonly width: number;
  readonly move: (event: PointerEvent, title: ReactNode, body: ReactNode) => void;
  readonly hide: () => void;
}

/** A chart's box: measures its width and places the one floating tip in the chart's own coordinates. */
function Plot(props: { readonly children: (api: TipApi) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const tip = useTipLayer();
  const move = (event: PointerEvent, title: ReactNode, body: ReactNode): void => {
    tip.show(event.clientX, event.clientY, title, body);
  };
  return (
    <div className="now-plot" ref={ref}>
      {props.children({ width, move, hide: tip.hide })}
      {tip.node}
    </div>
  );
}

/** SVG text in the card's tones. */
function Txt(props: {
  readonly x: number;
  readonly y: number;
  readonly children: ReactNode;
  readonly anchor?: "start" | "middle" | "end";
  readonly tone?: "muted" | "secondary" | "foreground" | "danger";
  readonly size?: number;
  readonly strong?: boolean;
  readonly halo?: boolean;
}) {
  return (
    <text
      className="now-t"
      x={props.x}
      y={props.y}
      textAnchor={props.anchor ?? "start"}
      fontSize={props.size ?? 11}
      data-tone={props.tone ?? "muted"}
      data-strong={props.strong === true || undefined}
      data-halo={props.halo === true || undefined}
    >
      {props.children}
    </text>
  );
}

/** Used share of the limit, from the window start to its reset, with the projection. */
function BurnSvg(props: {
  readonly forecast: Forecast;
  readonly now: number;
  readonly tip: TipApi;
}) {
  const { forecast: f, now, tip } = props;
  const patternId = `now-hatch-${useId().replaceAll(":", "")}`;
  const width = tip.width;
  const limit = f.account.story.primary;
  const marginLeft = 34;
  const marginRight = 6;
  const top = 28;
  const bottom = 22;
  const height = 176;
  const plotWidth = Math.max(0, width - marginLeft - marginRight);
  const plotHeight = height - top - bottom;
  const x = (at: number): number => marginLeft + ((at - f.start) / (f.end - f.start)) * plotWidth;
  const y = (value: number): number => top + plotHeight * (1 - Math.min(value, 100) / 100);
  const run = f.runsOut;

  // Readings before now. A mis reading breaks the line: unknown is not zero.
  const segments: (readonly [number, number])[][] = [[]];
  for (const reading of limit.readings) {
    if (reading.at >= now) continue;
    if (reading.used === null) {
      if ((segments.at(-1)?.length ?? 0) > 0) segments.push([]);
      continue;
    }
    segments.at(-1)?.push([reading.at, reading.used]);
  }
  segments.at(-1)?.push([now, f.used]);
  const trace = (points: readonly (readonly [number, number])[]): string =>
    points
      .map(([at, v], i) => `${i === 0 ? "M" : "L"}${x(at).toFixed(1)},${y(v).toFixed(1)}`)
      .join("");

  const endAt = run ?? f.end;
  const endValue = run === null ? (f.projected ?? f.used) : 100;
  const long = f.end - f.start > 10 * day;
  const step = long ? day : block;
  const columns: { readonly from: number; readonly to: number }[] = [];
  for (let at = f.start; at < f.end; at += step)
    columns.push({ from: at, to: Math.min(at + step, f.end) });

  const columnTip = (from: number, to: number): { title: string; body: string } => {
    const mid = (from + to) / 2;
    const title = long
      ? `${dayNames[new Date(mid).getDay()] ?? ""} ${shortDate(mid)}`
      : stampOf(from, now);
    if (mid <= now) {
      let seen: number | null = null;
      for (const reading of limit.readings) {
        if (reading.at > mid) break;
        seen = reading.used;
      }
      return { title, body: seen === null ? "No reading" : `Used ${Math.round(seen)}%` };
    }
    if (run !== null && mid >= run) return { title, body: "Locked" };
    return {
      title,
      body: `Projected ${Math.round((f.used * (mid - f.start)) / Math.max(1, now - f.start))}% used`,
    };
  };

  const late = run !== null && x(run) > marginLeft + plotWidth * 0.8;
  const summary =
    run === null
      ? `Used ${Math.round(f.used)}%. Projected ${Math.round(f.projected ?? 0)}% at reset ${stampOf(f.end, now)}.`
      : `Used ${Math.round(f.used)}%. Runs out ${stampOf(run, now)}. Locked ${hoursText(lockedHours(f))} until reset.`;

  return (
    <>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Burn-down of ${f.account.label}. ${summary}`}
        >
          <defs>
            <pattern
              id={patternId}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line className="now-hatch-line" x1="0" y1="0" x2="0" y2="5" />
            </pattern>
          </defs>
          {[0, 50, 100].map((v) => (
            <g key={v}>
              <line
                className="now-grid-line"
                data-limit={v === 100 || undefined}
                x1={marginLeft}
                x2={marginLeft + plotWidth}
                y1={y(v)}
                y2={y(v)}
              />
              <Txt x={marginLeft - 6} y={y(v) + 4} anchor="end" size={10}>{`${v}%`}</Txt>
            </g>
          ))}
          {run === null ? null : (
            <>
              <rect
                className="now-lock-tint"
                x={x(run)}
                y={top}
                width={x(f.end) - x(run)}
                height={plotHeight}
              />
              <rect
                fill={`url(#${patternId})`}
                x={x(run)}
                y={top}
                width={x(f.end) - x(run)}
                height={plotHeight}
              />
            </>
          )}
          <line className="now-even" x1={x(f.start)} y1={y(0)} x2={x(f.end)} y2={y(100)} />
          {segments.map((points) =>
            points.length < 2 ? null : (
              <g key={points[0]?.[0]}>
                <path
                  className="now-area"
                  d={`${trace(points)}L${x(points.at(-1)?.[0] ?? now)},${y(0)}L${x(points[0]?.[0] ?? now)},${y(0)}Z`}
                />
                <path className="now-actual" d={trace(points)} />
              </g>
            ),
          )}
          <line className="now-now" x1={x(now)} x2={x(now)} y1={top} y2={top + plotHeight} />
          <line className="now-proj" x1={x(now)} y1={y(f.used)} x2={x(endAt)} y2={y(endValue)} />
          <circle className="now-here" cx={x(now)} cy={y(f.used)} r={3.5} />
          {run === null ? (
            <>
              <circle className="now-end" cx={x(f.end)} cy={y(endValue)} r={3.5} />
              <Txt x={x(f.end) - 2} y={y(endValue) - 9} anchor="end" tone="foreground" strong halo>
                {`~${Math.round(endValue)}%`}
              </Txt>
            </>
          ) : (
            <>
              <line className="now-locked" x1={x(run)} x2={x(f.end)} y1={y(100)} y2={y(100)} />
              <circle className="now-out" cx={x(run)} cy={y(100)} r={4.5} />
              <Txt
                x={x(run) + (late ? 6 : 0)}
                y={y(100) - 10}
                anchor={late ? "end" : "middle"}
                tone="foreground"
                strong
                halo
              >
                {stampOf(run, now)}
              </Txt>
              {x(f.end) - x(run) > 110 ? (
                <Txt x={(x(run) + x(f.end)) / 2} y={y(50) + 4} anchor="middle" tone="danger" halo>
                  {`Locked ${hoursText(lockedHours(f))}`}
                </Txt>
              ) : null}
            </>
          )}
          {x(now) - marginLeft > 56 ? (
            <Txt x={marginLeft} y={height - 6}>
              {shortDate(f.start)}
            </Txt>
          ) : null}
          {/* "Reset Oct 16" is about 80 px wide at the right edge; drop "Now" before the two collide. */}
          {marginLeft + plotWidth - x(now) > 104 ? (
            <Txt x={x(now)} y={height - 6} anchor="middle" tone="secondary">
              Now
            </Txt>
          ) : null}
          <Txt
            x={marginLeft + plotWidth}
            y={height - 6}
            anchor="end"
          >{`Reset ${shortDate(f.end)}`}</Txt>
          {columns.map(({ from, to }) => (
            <rect
              key={from}
              className="now-hit"
              x={x(from)}
              y={top}
              width={Math.max(0, x(to) - x(from))}
              height={plotHeight}
              onPointerMove={(event) => {
                const { title, body } = columnTip(from, to);
                tip.move(event, title, body);
              }}
              onPointerLeave={tip.hide}
            />
          ))}
        </svg>
      ) : null}
    </>
  );
}

function BurnDown(props: { readonly forecast: Forecast; readonly now: number }) {
  const run = props.forecast.runsOut;
  return (
    <div className="now-burn">
      <Plot>{(tip) => <BurnSvg forecast={props.forecast} now={props.now} tip={tip} />}</Plot>
      <Legend>
        <span>
          <Swatch kind="line" />
          Used
        </span>
        <span>
          <Swatch kind="dash" />
          Current pace
        </span>
        <span>
          <i className="now-sw" data-kind="even" aria-hidden="true" />
          Even pace
        </span>
        {run === null ? null : (
          <>
            <span>
              <Swatch kind="dot" />
              Runs out
            </span>
            <span>
              <i className="now-sw" data-kind="hatch" aria-hidden="true" />
              Locked until reset
            </span>
          </>
        )}
      </Legend>
    </div>
  );
}

function factsOf(f: Forecast, now: number): readonly (readonly [string, string])[] {
  const pace = `${(f.pace ?? 0).toFixed(1)}x even`;
  if (f.runsOut !== null) {
    return [
      ["Pace", pace],
      ["Runs out", stampOf(f.runsOut, now)],
      ["Locked before reset", hoursText(lockedHours(f))],
    ];
  }
  return [
    ["Pace", pace],
    ["At reset", `~${Math.round(f.projected ?? 0)}% used`],
    ["Resets", untilText(f.end, now)],
  ];
}

function Facts(props: { readonly forecast: Forecast; readonly now: number }) {
  return (
    <dl className="now-facts">
      {factsOf(props.forecast, props.now).map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AccountHead(props: { readonly forecast: Forecast }) {
  const { account } = props.forecast;
  const { story } = account;
  const plan = story.plan === null ? story.providerName : `${story.providerName} ${story.plan}`;
  return (
    <div className="now-head">
      <AccountLabel account={account} strong sub={`${plan} · ${story.name}`} />
      <p className="now-sub">
        {`Used ${Math.round(props.forecast.used)}% in ${Math.round(props.forecast.elapsed * 100)}% of the window`}
      </p>
    </div>
  );
}

/** Points of the limit used per day over the last seven days, against the pace that would last to the reset. */
/** Points a day that would use the limit up exactly at its reset. */
function allowedPerDay(f: Forecast, now: number): number {
  return Math.max(0, 100 - f.used) / Math.max(0.01, (f.end - now) / day);
}

function RecentSvg(props: {
  readonly forecast: Forecast;
  readonly series: Series;
  readonly tip: TipApi;
}) {
  const { forecast: f, series, tip } = props;
  const width = tip.width;
  const account = f.account;
  // Local calendar days, midnight to midnight. Today is partial: it ends at the last full hour of the series.
  const today = new Date(series.now);
  const dayStart = (back: number): number =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - back).getTime();
  const days = Array.from({ length: 7 }, (_, d) => {
    const start = dayStart(6 - d);
    const isToday = d === 6;
    const end = isToday ? series.now : dayStart(5 - d);
    let sum = 0;
    let known = 0;
    let locked = 0;
    let slots = 0;
    for (let slot = 0; slot < slotCount; slot += 1) {
      const at = series.from + slot * hour;
      if (at < start || at >= end) continue;
      slots += 1;
      const value = account.hourly[slot];
      if (value !== null && value !== undefined) {
        sum += value;
        known += 1;
      }
      if (account.locked[slot] === true) locked += 1;
    }
    return {
      at: start,
      value: known === 0 ? null : sum,
      locked: slots > 0 && locked === slots,
      // A partial day is judged against the share of a day's allowance that has elapsed.
      share: isToday ? Math.min(1, Math.max(0.05, (series.now - start) / day)) : 1,
      label: isToday ? "Today" : (dayNames[new Date(start).getDay()] ?? ""),
    };
  });
  const left = Math.max(0, 100 - f.used);
  const allowed = left / Math.max(0.01, (f.end - series.now) / day);
  const atLimit = f.used >= 100;
  const top = 16;
  const bottom = 20;
  const height = 104;
  const plotHeight = height - top - bottom;
  const base = top + plotHeight;
  const max = Math.max(1, allowed, ...days.map((d) => d.value ?? 0)) * 1.1;
  const y = (value: number): number => base - (value / max) * plotHeight;
  const band = width / 7;
  return (
    <>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Recent pace of ${account.label}, last seven days. ${atLimit ? "Limit reached" : `Allowed ${allowed.toFixed(1)} pp a day`}.`}
        >
          <line className="now-grid-line" x1={0} x2={width} y1={base} y2={base} />
          {days.map((d, i) => {
            const mid = i * band + band / 2;
            const barHeight = d.value === null ? 0 : Math.max(1, base - y(d.value));
            const over = d.value !== null && d.value > allowed * d.share;
            const body = d.locked
              ? "Locked, use unknown"
              : d.value === null
                ? "No readings"
                : `${d.value.toFixed(1)} pp used${atLimit ? ". Limit reached" : `. Allowed ${allowed.toFixed(1)} pp a day`}`;
            return (
              <g key={d.at}>
                <Txt x={mid} y={height - 5} anchor="middle" size={10}>
                  {d.label}
                </Txt>
                {d.locked ? (
                  <line
                    className="now-locked"
                    x1={mid - 7}
                    x2={mid + 7}
                    y1={base - 1}
                    y2={base - 1}
                  />
                ) : d.value === null ? (
                  <line
                    className="now-grid-line"
                    data-limit
                    x1={mid - 7}
                    x2={mid + 7}
                    y1={base - 1}
                    y2={base - 1}
                  />
                ) : (
                  <>
                    <rect
                      className="now-bar"
                      data-over={over || undefined}
                      x={mid - 9}
                      y={base - barHeight}
                      width={18}
                      height={barHeight}
                      rx={2}
                    />
                    <Txt
                      x={mid}
                      y={base - barHeight - 4}
                      anchor="middle"
                      size={10}
                      tone="secondary"
                    >
                      {d.value.toFixed(0)}
                    </Txt>
                  </>
                )}
                <rect
                  className="now-hit"
                  x={i * band}
                  y={top}
                  width={band}
                  height={plotHeight + bottom}
                  onPointerMove={(event) => tip.move(event, d.label, body)}
                  onPointerLeave={tip.hide}
                />
              </g>
            );
          })}
          {atLimit ? null : (
            <line className="now-allowed" x1={0} x2={width} y1={y(allowed)} y2={y(allowed)} />
          )}
        </svg>
      ) : null}
    </>
  );
}

function RecentPace(props: { readonly forecast: Forecast; readonly series: Series }) {
  const caption =
    props.forecast.used >= 100
      ? "Limit reached"
      : `Allowed: ${allowedPerDay(props.forecast, props.series.now).toFixed(1)} pp a day`;
  return (
    <div className="now-recent">
      <p className="now-sec">
        <b>Recent pace</b> · pp used per day
      </p>
      <p className="now-sub">{caption}</p>
      <Plot>
        {(tip) => <RecentSvg forecast={props.forecast} series={props.series} tip={tip} />}
      </Plot>
      <Legend>
        <span>
          <i className="now-sw" data-kind="bar" aria-hidden="true" />
          Within allowance
        </span>
        <span>
          <i className="now-sw" data-kind="over" aria-hidden="true" />
          Over
        </span>
        <span>
          <i className="now-sw" data-kind="allowed" aria-hidden="true" />
          Allowed per day
        </span>
      </Legend>
    </div>
  );
}

/* ---------------- Forecast grid ---------------- */

function ForecastView(props: {
  readonly rows: readonly Forecast[];
  readonly selected: Forecast | undefined;
  readonly onSelect: (id: string) => void;
  readonly series: Series;
  readonly lit: (line: Line) => void;
  readonly clear: () => void;
}) {
  const { series, rows } = props;
  const now = series.now;
  // The first block starts at the six-hour boundary at or before now.
  const origin = new Date(now);
  origin.setHours(Math.floor(origin.getHours() / 6) * 6, 0, 0, 0);
  const base = origin.getTime();
  const horizon = base + blocks * block;
  const fraction = (at: number): number => (at - base) / (blocks * block);
  const nowAt = fraction(now);

  const headers: { readonly index: number; readonly name: string }[] = [];
  for (let j = 0; j < blocks; j += 1) {
    const at = new Date(base + j * block);
    if (j === 0 || at.getHours() === 0)
      headers.push({ index: j, name: dayNames[at.getDay()] ?? "" });
  }

  return (
    <div className="an2-split now-split">
      <div className="now-fc">
        <Plot>
          {(tip) => (
            <div className="now-scroll">
              <div className="now-grid">
                <div className="now-rowline now-axis" aria-hidden="true">
                  <span />
                  <span className="now-axis-days">
                    <span className="now-now-label" style={{ left: `${nowAt * 100}%` }}>
                      Now
                    </span>
                    {headers.map((h) => (
                      <span
                        key={h.index}
                        className="now-axis-day"
                        style={{ left: `${(h.index / blocks) * 100}%` }}
                      >
                        {h.name}
                      </span>
                    ))}
                  </span>
                  <span />
                </div>
                <div className="now-body">
                  <span
                    className="now-nowline"
                    aria-hidden="true"
                    style={{
                      left: `calc(var(--now-label) + (100% - var(--now-label) - var(--now-gutter)) * ${nowAt})`,
                    }}
                  />
                  {rows.map((f) => (
                    <ForecastRow
                      key={f.account.id}
                      f={f}
                      on={props.selected?.account.id === f.account.id}
                      now={now}
                      base={base}
                      horizon={horizon}
                      fraction={fraction}
                      onSelect={props.onSelect}
                      lit={props.lit}
                      clear={() => {
                        tip.hide();
                        props.clear();
                      }}
                      move={tip.move}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </Plot>
        <Legend>
          <span>
            Projected use
            <i className="now-cell now-sw-cell" data-level="0" />
            <i className="now-cell now-sw-cell" data-level="1" />
            <i className="now-cell now-sw-cell" data-level="2" />
            <i className="now-cell now-sw-cell" data-level="3" />
            under 25, 50, 75, 100%
          </span>
          <span>
            <i className="now-cell now-sw-cell" data-kind="out" />
            Runs out
          </span>
          <span>
            <i className="now-sw" data-kind="hatch" aria-hidden="true" />
            Locked until reset
          </span>
          <span>
            <i className="now-sw" data-kind="tick" aria-hidden="true" />
            Reset
          </span>
          <span>
            <i className="now-cell now-sw-cell" data-kind="new" />
            New window, no forecast
          </span>
          <span>Assumes the pace holds. Select a row for detail.</span>
        </Legend>
      </div>
      <aside className="an2-panel" aria-label="Selected account">
        {props.selected === undefined ? (
          <p className="now-sub">No forecast yet.</p>
        ) : (
          <>
            <AccountHead forecast={props.selected} />
            <BurnDown forecast={props.selected} now={now} />
            <Facts forecast={props.selected} now={now} />
            <RecentPace forecast={props.selected} series={series} />
          </>
        )}
      </aside>
    </div>
  );
}

function ForecastRow(props: {
  readonly f: Forecast;
  readonly on: boolean;
  readonly now: number;
  readonly base: number;
  readonly horizon: number;
  readonly fraction: (at: number) => number;
  readonly onSelect: (id: string) => void;
  readonly lit: (line: Line) => void;
  readonly clear: () => void;
  readonly move: (event: PointerEvent, title: ReactNode, body: ReactNode) => void;
}) {
  const { f, now, base, horizon } = props;
  const cells = useRef<HTMLSpanElement>(null);
  const label = f.account.label;
  const usable = ready(f);
  const gutterA = f.note ?? outcome(f, now);
  const gutterB = !usable
    ? ""
    : f.end >= horizon
      ? `Resets ${shortDate(f.end)} →`
      : `Resets ${stampOf(f.end, now)}`;
  const info = (j: number): { readonly title: string; readonly body: string } => {
    const from = base + j * block;
    const to = from + block;
    const range = `${dayNames[new Date(from).getDay()] ?? ""} ${pad(new Date(from).getHours())}:00-${pad(new Date(to).getHours())}:00`;
    const title = `${label} · ${range}`;
    if (!usable) return { title, body: `${f.note ?? ""}.` };
    if (from >= f.end)
      return { title, body: `New window after reset ${stampOf(f.end, now)}. Not forecast.` };
    if (f.runsOut !== null && to > f.runsOut) {
      return from <= f.runsOut
        ? {
            title,
            body: `Runs out ${stampOf(f.runsOut, now)}. Locked ${hoursText(lockedHours(f))} before reset.`,
          }
        : { title, body: `Locked until reset ${stampOf(f.end, now)}` };
    }
    return {
      title,
      body: `Projected ${Math.round(projectedAt(j))}% used by block end`,
    };
  };
  const projectedAt = (j: number): number => {
    const end = Math.min(base + (j + 1) * block, f.end);
    return (f.used * (end - f.start)) / Math.max(1, now - f.start);
  };
  const blockAt = (event: PointerEvent): number | null => {
    const box = cells.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return null;
    const j = Math.floor(((event.clientX - box.left) / box.width) * blocks);
    return j >= 0 && j < blocks ? j : null;
  };
  const onMove = (event: PointerEvent): void => {
    const j = blockAt(event);
    if (j === null) {
      props.lit({ big: label, cap: rowCaption(f, now) });
      props.move(event, label, rowCaption(f, now));
      return;
    }
    const { title, body } = info(j);
    props.lit({ big: title, cap: body });
    props.move(event, title, body);
  };
  const onKeyFocus = (): void => props.lit({ big: label, cap: rowCaption(f, now) });
  return (
    <button
      type="button"
      className="now-row now-rowline"
      data-on={props.on || undefined}
      data-muted={!usable || undefined}
      disabled={!usable}
      aria-pressed={usable ? props.on : undefined}
      aria-label={`${label}. ${rowCaption(f, now)}`}
      onClick={() => props.onSelect(f.account.id)}
      onPointerMove={onMove}
      onPointerLeave={props.clear}
      onFocus={onKeyFocus}
      onBlur={props.clear}
    >
      <span className="now-who">
        <AccountLabel account={f.account} strong={props.on} />
      </span>
      <span className="now-cells" ref={cells}>
        {Array.from({ length: blocks }, (_, j) => {
          const from = base + j * block;
          const to = from + block;
          const after = !usable || from >= f.end;
          const firstAfter = usable && from >= f.end && (j === 0 || from - block < f.end);
          let kind: string | undefined;
          let level: number | undefined;
          if (after) kind = "new";
          else if (f.runsOut !== null && to > f.runsOut)
            kind = from <= f.runsOut ? "out" : "locked";
          else {
            const p = projectedAt(j);
            level = p < 25 ? 0 : p < 50 ? 1 : p < 75 ? 2 : 3;
          }
          return (
            <i
              key={from}
              className="now-cell"
              data-kind={kind}
              data-level={level}
              data-day={new Date(from).getHours() === 0 || undefined}
            >
              {firstAfter ? <em>reset</em> : null}
            </i>
          );
        })}
        {/* A run-out past the seven days shows only in the words on the right, not as a stray dot. */}
        {usable && f.runsOut !== null && props.fraction(f.runsOut) <= 1 ? (
          <i className="now-dot" style={{ left: `${props.fraction(f.runsOut) * 100}%` }} />
        ) : null}
        {usable && f.end < horizon ? (
          <i className="now-tick" style={{ left: `${props.fraction(f.end) * 100}%` }} />
        ) : null}
      </span>
      <span className="now-gutter">
        <span className="now-gutter-a" data-out={f.runsOut !== null || undefined}>
          {gutterA}
        </span>
        <span className="now-gutter-b">{gutterB}</span>
      </span>
    </button>
  );
}

/* ---------------- Table ---------------- */

type SortKey = "account" | "used" | "pace" | "risk" | "resets";
interface Sort {
  readonly key: SortKey;
  readonly dir: 1 | -1;
}

const columns: readonly {
  readonly key: SortKey;
  readonly title: string;
  readonly first: 1 | -1;
  readonly compare: (p: Forecast, q: Forecast) => number;
}[] = [
  {
    key: "account",
    title: "Account",
    first: 1,
    compare: (p, q) => p.account.label.localeCompare(q.account.label),
  },
  { key: "used", title: "Used", first: -1, compare: (p, q) => p.used - q.used },
  {
    key: "pace",
    title: "Pace",
    first: -1,
    compare: (p, q) => (p.projected ?? 0) - (q.projected ?? 0),
  },
  { key: "risk", title: "Runs out / at reset", first: 1, compare: attention },
  { key: "resets", title: "Resets", first: 1, compare: (p, q) => p.end - q.end },
];

function Caret(props: { readonly up: boolean }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
      <path
        d={props.up ? "M1 5.5 4 2.5 7 5.5" : "M1 2.5 4 5.5 7 2.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TableView(props: {
  readonly rows: readonly Forecast[];
  readonly selected: Forecast | undefined;
  readonly onSelect: (id: string) => void;
  readonly series: Series;
  readonly lit: (line: Line) => void;
  readonly clear: () => void;
}) {
  const { series } = props;
  const now = series.now;
  const [sort, setSort] = useState<Sort>({ key: "risk", dir: 1 });
  const column = columns.find((c) => c.key === sort.key) ?? columns[3];
  const usable = props.rows
    .filter(ready)
    .toSorted((p, q) => (column?.compare(p, q) ?? 0) * sort.dir || attention(p, q));
  const rows = [...usable, ...props.rows.filter((f) => !ready(f))];
  const keySelect = (event: KeyboardEvent, id: string): void => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      props.onSelect(id);
    }
  };
  return (
    <div className="now-view">
      <div className="now-tablewrap">
        <table className="now-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={
                    c.key === sort.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort(
                        c.key === sort.key
                          ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 }
                          : { key: c.key, dir: c.first },
                      )
                    }
                  >
                    {c.title}
                    {c.key === sort.key ? <Caret up={sort.dir === 1} /> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const usableRow = ready(f);
              const on = props.selected?.account.id === f.account.id;
              const pace = f.pace ?? 0;
              return (
                <tr
                  key={f.account.id}
                  data-on={on || undefined}
                  data-muted={!usableRow || undefined}
                >
                  <td>
                    <button
                      type="button"
                      className="now-pick"
                      disabled={!usableRow}
                      aria-pressed={usableRow ? on : undefined}
                      onClick={() => props.onSelect(f.account.id)}
                      onKeyDown={(event) => keySelect(event, f.account.id)}
                      onPointerEnter={() =>
                        props.lit({
                          big: f.account.label,
                          cap: `${rowCaption(f, now)}${usableRow ? ` · ${pace.toFixed(1)}x even pace` : ""}`,
                        })
                      }
                      onPointerLeave={props.clear}
                      onFocus={() => props.lit({ big: f.account.label, cap: rowCaption(f, now) })}
                      onBlur={props.clear}
                    >
                      <AccountLabel account={f.account} />
                    </button>
                  </td>
                  <td>
                    <span className="now-num">{Math.round(f.used)}%</span>
                    <span
                      className="now-meter"
                      role="img"
                      aria-label={`Used ${Math.round(f.used)}% in ${Math.round(f.elapsed * 100)}% of the window`}
                    >
                      <i style={{ width: `${Math.min(100, f.used)}%` }} />
                      <b style={{ left: `${f.elapsed * 100}%` }} />
                    </span>
                  </td>
                  <td className={cx("now-pace", usableRow && pace > 1.1 && "warn")}>
                    {usableRow ? `${pace.toFixed(1)}x` : "Unknown"}
                  </td>
                  <td>
                    {!usableRow ? (
                      <span className="now-quiet">{f.note}</span>
                    ) : f.runsOut !== null ? (
                      <span className="now-risk">
                        <i className="now-dot-inline" aria-hidden="true" />
                        {stampOf(f.runsOut, now)}
                      </span>
                    ) : (
                      <span className="now-quiet">
                        {f.used >= 100 ? "At the limit" : `~${Math.round(f.projected ?? 0)}%`}
                      </span>
                    )}
                  </td>
                  <td className="now-pace">{untilText(f.end, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Legend>
        <span>
          <Swatch kind="dot" />
          Runs out before reset
        </span>
        <span>
          <span className="now-meter" data-mini aria-hidden="true">
            <b style={{ left: "50%" }} />
          </span>
          Tick: even pace
        </span>
        <span>
          <b className="now-warn-text">1.2x</b>Faster than even pace
        </span>
        <span>Select a header to sort, a row for detail.</span>
      </Legend>
      {props.selected === undefined ? null : (
        <div className="now-detail">
          <div className="now-detail-a">
            <AccountHead forecast={props.selected} />
            <BurnDown forecast={props.selected} now={now} />
          </div>
          <div className="now-detail-b">
            <Facts forecast={props.selected} now={now} />
            <RecentPace forecast={props.selected} series={series} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Card ---------------- */

export function RightNowCard(props: { readonly series: Series }) {
  const { series } = props;
  const [view, setView] = useStoredView("now", ["forecast", "table"] as const, "forecast");
  const [picked, setPicked] = useState<string | null>(null);
  const all = series.accounts.map((account) => forecastOf(account, series.now));
  const ordered = [...all.filter(ready).toSorted(attention), ...all.filter((f) => !ready(f))];
  const selected = ordered.find((f) => f.account.id === picked && ready(f)) ?? ordered.find(ready);
  const headline = useHeadline(headlineOf(all, series.now));
  const shared = {
    selected,
    onSelect: setPicked,
    series,
    lit: headline.show,
    clear: headline.clear,
  };
  return (
    <ViewCard
      title="Right Now"
      views={[
        { value: "forecast", label: "Forecast" },
        { value: "table", label: "Table" },
      ]}
      view={view}
      onView={setView}
    >
      <CardTop headline={headline.node} />
      {view === "forecast" ? (
        <ForecastView rows={ordered} {...shared} />
      ) : (
        <TableView rows={ordered} {...shared} />
      )}
    </ViewCard>
  );
}
