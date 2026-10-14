import { useCallback, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";

import { BrandMark } from "../../icons.tsx";
import { Segmented } from "../../ui/segmented.tsx";
import {
  AccountFilter,
  CardTop,
  FullName,
  Legend,
  Swatch,
  UsageLanes,
  ViewCard,
  day,
  hour,
  useHeadline,
  useTipLayer,
  useStoredView,
  useWidth,
  weekdays,
  type Line,
} from "./common.tsx";
import { hourOfWeek, slotCount, type AccountSeries, type Series } from "./series.ts";
import "./rhythm.css";

/**
 * Rhythm (mockup): when limits are used and where they ran out, in four views of the same hourly series. All
 * accounts is a count of active accounts, never a sum of percentages. An unknown hour is an empty dotted cell.
 */

type View = "matrix" | "weeks" | "range" | "accounts";
const views = [
  { value: "matrix", label: "Matrix" },
  { value: "weeks", label: "Weeks" },
  { value: "range", label: "Range" },
  { value: "accounts", label: "By Account" },
] as const satisfies readonly { readonly value: View; readonly label: string }[];
const viewKeys: readonly View[] = views.map((entry) => entry.value);

export function RhythmCard(props: { readonly series: Series }) {
  const [view, setView] = useStoredView<View>("rhythm", viewKeys, "matrix");
  return (
    <ViewCard title="Rhythm" views={views} view={view} onView={setView}>
      {view === "matrix" ? <Matrix series={props.series} /> : null}
      {view === "weeks" ? <Weeks series={props.series} /> : null}
      {view === "range" ? <RangeView series={props.series} /> : null}
      {view === "accounts" ? <ByAccount series={props.series} /> : null}
    </ViewCard>
  );
}

/* ---------------------------------------------------------------- helpers */

const longDays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
/** Grey ramp steps; the same numbers as the `.an2-cell[data-level]` rules in common.css. */
const RAMP = [5, 18, 34, 54, 76] as const;
/** Ramp steps for one account, which has four levels. */
const ONE_LEVELS = [0, 1, 2, 4] as const;

const fgMix = (percent: number): string =>
  `color-mix(in oklab, var(--foreground) ${percent}%, var(--surface))`;
const dangerMix = (percent: number): string =>
  `color-mix(in oklab, var(--danger) ${percent}%, var(--surface))`;
/** A continuous grey for a share 0..1; the quietest cells fall back to a faint tint. */
const shareFill = (share: number): string => fgMix(share < 0.06 ? 6 : 14 + share * 74);

// One formatter, made once: toLocaleDateString builds a new one on every call.
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const fmtDay = (at: number): string => dayFormat.format(at);
const hh = (hourValue: number): string => `${String(hourValue).padStart(2, "0")}:00`;
const weekdayOf = (at: number): number => (new Date(at).getDay() + 6) % 7;
const hourOf = (at: number): number => new Date(at).getHours();
const fmtTime = (at: number): string =>
  `${weekdays[weekdayOf(at)] ?? ""} ${String(hourOf(at)).padStart(2, "0")}:${String(
    new Date(at).getMinutes(),
  ).padStart(2, "0")}`;
const fmtHours = (hours: number): string =>
  hours >= 48 ? `${Math.round(hours / 24)} days` : `${Math.round(hours)} h`;
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
const midnight = (at: number): number => {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};
const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

const slotOf = (series: Series, at: number): number => Math.round((at - series.from) / hour);
const slotTime = (series: Series, slot: number): number => series.from + slot * hour;
/** A slot that exists and has started. Later hours of today are empty. */
const inRange = (series: Series, slot: number): boolean =>
  slot >= 0 && slot < slotCount && slotTime(series, slot) <= series.now;

/** The value in a slot: active accounts for All, percentage points of its own limit for one account. Null is unknown. */
function valueAt(series: Series, account: AccountSeries | null, slot: number): number | null {
  if (account === null) return series.active[slot] ?? 0;
  return account.hourly[slot] ?? null;
}
function lockedAt(series: Series, account: AccountSeries | null, slot: number): number {
  if (account === null) return series.locked[slot] ?? 0;
  return account.locked[slot] === true ? 1 : 0;
}
const runsOf = (series: Series, account: AccountSeries | null) =>
  account === null ? series.runouts : series.runouts.filter((run) => run.accountId === account.id);
const labelOf = (series: Series, id: string): string =>
  series.accounts.find((account) => account.id === id)?.label ?? "";
const unitOf = (account: AccountSeries | null): string =>
  account === null ? "avg accounts active" : "avg pp used per hour";
const unitShort = (account: AccountSeries | null): string =>
  account === null ? "accounts active" : "pp per hour";
const runText = (series: Series, run: Series["runouts"][number]): string =>
  `Ran out ${fmtTime(run.at)}, locked ${fmtHours(Math.round((Math.min(run.until, series.now) - run.at) / hour))}`;

/** Average peak of an account's finished windows; the order of rows and lanes. */
function averagePeak(account: AccountSeries): number {
  const past = account.curves.filter((curve) => !curve.current);
  const list = past.length > 0 ? past : account.curves;
  return list.reduce((sum, curve) => sum + curve.peak, 0) / Math.max(1, list.length);
}

/** Index of the largest known value, or -1 when none is known. */
function argMax(values: readonly (number | null)[]): number {
  let best = -1;
  let bestValue = Number.NEGATIVE_INFINITY;
  values.forEach((value, index) => {
    if (value !== null && value > bestValue) {
      bestValue = value;
      best = index;
    }
  });
  return best;
}

function lockedTotal(account: AccountSeries): number {
  return account.locked.reduce((sum, value) => sum + (value ? 1 : 0), 0);
}

function cellText(series: Series, account: AccountSeries | null, slot: number): [string, string] {
  const at = slotTime(series, slot);
  const big = `${weekdays[weekdayOf(at)] ?? ""} ${fmtDay(at)} · ${hh(hourOf(at))}`;
  let cap: string;
  if (account === null) {
    const active = series.active[slot] ?? 0;
    const locked = series.locked[slot] ?? 0;
    cap = `${active} of ${series.accounts.length} accounts active${locked > 0 ? `, ${locked} locked` : ""}`;
  } else {
    const value = account.hourly[slot] ?? null;
    if (value === null) {
      cap = `No reading${account.locked[slot] === true ? ", locked" : ""}`;
    } else {
      const ratio = value / account.evenHour;
      cap = `${value.toFixed(1)} pp used, ${
        ratio < 0.6 ? "quiet" : `${ratio.toFixed(1)}x even pace`
      }${account.locked[slot] === true ? ", locked" : ""}`;
    }
  }
  const hit = runsOf(series, account).filter(
    (run) => Math.floor((run.at - series.from) / hour) === slot,
  );
  if (hit.length > 0) {
    cap += `. ${hit.map((run) => `${labelOf(series, run.accountId)}: ${runText(series, run)}`).join("; ")}`;
  }
  return [big, cap];
}

/** Weekday and weekend average per hour of day. Unknown hours are left out of the mean. */
function dayProfile(series: Series, account: AccountSeries | null) {
  const sums = [Array.from({ length: 24 }, () => 0), Array.from({ length: 24 }, () => 0)];
  const counts = [Array.from({ length: 24 }, () => 0), Array.from({ length: 24 }, () => 0)];
  for (let slot = 0; slot < slotCount; slot += 1) {
    const value = valueAt(series, account, slot);
    if (value === null) continue;
    const at = slotTime(series, slot);
    const group = weekdayOf(at) >= 5 ? 1 : 0;
    const h = hourOf(at);
    const row = sums[group];
    const count = counts[group];
    if (row === undefined || count === undefined) continue;
    row[h] = (row[h] ?? 0) + value;
    count[h] = (count[h] ?? 0) + 1;
  }
  const mean = (group: number): number[] =>
    Array.from({ length: 24 }, (_, h) => {
      const n = counts[group]?.[h] ?? 0;
      return n > 0 ? (sums[group]?.[h] ?? 0) / n : 0;
    });
  return { wd: mean(0), we: mean(1) };
}

function summary(series: Series, account: AccountSeries | null) {
  const { wd } = dayProfile(series, account);
  let best = 0;
  let bestSum = -1;
  for (let start = 0; start <= 21; start += 1) {
    const total = (wd[start] ?? 0) + (wd[start + 1] ?? 0) + (wd[start + 2] ?? 0);
    if (total > bestSum) {
      bestSum = total;
      best = start;
    }
  }
  const runs = runsOf(series, account);
  const weekdayRuns = runs.filter((run) => weekdayOf(run.at) < 5).length;
  const hours = runs.map((run) => hourOf(run.at));
  const who = account === null ? "" : `${account.label}: `;
  const cap =
    runs.length === 0
      ? `${who}no run-outs in 30 days`
      : `${who}${plural(runs.length, "run-out")} in 30 days, ${
          weekdayRuns === runs.length ? "all on weekdays" : `${weekdayRuns} on weekdays`
        }, ${hh(Math.min(...hours))}-${hh(Math.max(...hours) + 1)}`;
  const band = `${hh(best)}-${hh(best + 3)}`;
  return { band, cap, big: `Busiest ${band} on weekdays` };
}

/** The calendar days covering the series, from the day of its start to today. */
function calendarOf(series: Series) {
  const day0 = midnight(series.from);
  const columns = Math.round((midnight(series.now) - day0) / day) + 1;
  const base = new Date(day0);
  const atDay = (index: number, h = 0): number =>
    new Date(base.getFullYear(), base.getMonth(), base.getDate() + index, h).getTime();
  return { day0, columns, atDay };
}

/* ------------------------------------------------------- hover and readout */

/** The headline that swaps on hover plus the one tooltip, which follows the pointer. */
function useReadout(base: Line) {
  const headline = useHeadline(base);
  const tip = useTipLayer();
  const place = useCallback(
    (event: PointerEvent, big: string, cap: string) =>
      tip.show(event.clientX, event.clientY, big, cap),
    [tip],
  );
  const at = useCallback(
    (event: PointerEvent, big: string, cap: string) => {
      headline.show({ big, cap });
      place(event, big, cap);
    },
    [headline, place],
  );
  const leave = useCallback(() => {
    headline.clear();
    tip.hide();
  }, [headline, tip]);
  const bind = useCallback(
    (big: string, cap: string) => ({
      onPointerEnter: (event: PointerEvent) => at(event, big, cap),
      onPointerMove: (event: PointerEvent) => place(event, big, cap),
      onPointerLeave: leave,
    }),
    [at, place, leave],
  );
  /** Like `bind`, but builds the words only when the pointer arrives: a chart has hundreds of cells. */
  const bindLazy = useCallback(
    (words: () => readonly [string, string]) => ({
      onPointerEnter: (event: PointerEvent) => {
        const [big, cap] = words();
        at(event, big, cap);
      },
      onPointerMove: (event: PointerEvent) => {
        const [big, cap] = words();
        place(event, big, cap);
      },
      onPointerLeave: leave,
    }),
    [at, place, leave],
  );
  return { headline: headline.node, at, leave, bind, bindLazy, tipNode: tip.node };
}

function Mark(props: {
  readonly account: AccountSeries;
  readonly x: number;
  readonly y: number;
  readonly size?: number;
}) {
  const size = props.size ?? 14;
  return (
    <foreignObject x={props.x} y={props.y} width={size} height={size} className="rh-mark">
      <BrandMark provider={props.account.story.provider} />
    </foreignObject>
  );
}

const Dot = (props: { readonly cx: number; readonly cy: number; readonly r: number }) => (
  <circle className="rh-dot" cx={props.cx} cy={props.cy} r={props.r} />
);

/* ----------------------------------------------------------------- Matrix */

function Matrix(props: { readonly series: Series }) {
  const { series } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const [lanes, setLanes] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const account = series.accounts.find((entry) => entry.id === selected) ?? null;
  const sm = useMemo(() => summary(series, account), [series, account]);
  const readout = useReadout({ big: sm.big, cap: sm.cap });
  const { bind, bindLazy } = readout;
  const { day0, columns, atDay } = useMemo(() => calendarOf(series), [series]);
  const profile = useMemo(() => dayProfile(series, account), [series, account]);
  const runs = runsOf(series, account);

  const narrow = width < 640;
  const gutter = narrow ? 36 : 48;
  const margin = narrow ? 0 : 160;
  const mw = width - gutter - margin;
  const cw = mw / columns;
  const rh = narrow ? 12 : 14;
  const top = 36;
  const mh = 24 * rh;

  const level = (slot: number): number | null => {
    const value = valueAt(series, account, slot);
    if (value === null) return null;
    if (account === null) {
      // Steps scale with the number of accounts, so the ramp reads the same for 4 accounts or 14.
      const share = value / Math.max(1, series.accounts.length);
      return value === 0 ? 0 : share <= 0.2 ? 1 : share <= 0.4 ? 2 : share <= 0.6 ? 3 : 4;
    }
    const ratio = value / account.evenHour;
    const step = ratio < 0.6 ? 0 : ratio < 1.5 ? 1 : ratio < 2.5 ? 2 : 3;
    return ONE_LEVELS[step];
  };

  const runSlots = new Map<number, number>();
  for (const run of runs) {
    const slot = Math.floor((run.at - series.from) / hour);
    if (slot >= 0 && slot < slotCount) runSlots.set(slot, (runSlots.get(slot) ?? 0) + 1);
  }
  const runHours = new Map<number, number>();
  for (const run of runs) runHours.set(hourOf(run.at), (runHours.get(hourOf(run.at)) ?? 0) + 1);

  const axis: ReactNode[] = [];
  const cells: ReactNode[] = [];
  const over: ReactNode[] = [];
  for (let d = 0; d < columns; d += 1) {
    const at = atDay(d);
    const x = gutter + d * cw;
    const weekend = weekdayOf(at) >= 5;
    const today = d === columns - 1;
    // A date that would run past the matrix is left out rather than squeezed against the previous one.
    if (d % 7 === 0 && x + 44 <= gutter + columns * cw) {
      axis.push(
        <text key={`m${d}`} className="rh-t rh-t2" x={x} y={10}>
          {fmtDay(at)}
        </text>,
      );
    }
    axis.push(
      <text
        key={`w${d}`}
        className="rh-t"
        data-tone={today ? "now" : weekend ? "weekend" : undefined}
        x={x + cw / 2}
        y={26}
        textAnchor="middle"
      >
        {(weekdays[weekdayOf(at)] ?? "?").slice(0, 1)}
      </text>,
    );
    if (weekend) {
      axis.push(
        <rect
          key={`b${d}`}
          className="rh-weekend"
          x={x + 1}
          y={top - 6}
          width={Math.max(0, cw - 2)}
          height={2}
          rx={1}
        />,
      );
    }
    for (let h = 0; h < 24; h += 1) {
      const slot = slotOf(series, atDay(d, h));
      const y = top + h * rh;
      if (!inRange(series, slot)) {
        cells.push(
          <circle key={`${d}.${h}`} className="rh-empty" cx={x + cw / 2} cy={y + rh / 2} r={1} />,
        );
        continue;
      }
      const step = level(slot);
      cells.push(
        step === null ? (
          <rect
            key={`${d}.${h}`}
            className="rh-cell rh-unknown"
            x={x + 0.5}
            y={y + 0.5}
            width={Math.max(0, cw - 1)}
            height={rh - 1}
            rx={2}
            {...bindLazy(() => cellText(series, account, slot))}
          />
        ) : (
          <rect
            key={`${d}.${h}`}
            className="rh-cell"
            x={x + 0.5}
            y={y + 0.5}
            width={Math.max(0, cw - 1)}
            height={rh - 1}
            rx={2}
            style={{ fill: fgMix(RAMP[step] ?? 5) }}
            {...bindLazy(() => cellText(series, account, slot))}
          />
        ),
      );
      if (account !== null && lockedAt(series, account, slot) > 0) {
        over.push(
          <rect
            key={`l${d}.${h}`}
            className="rh-over"
            x={x + 0.5}
            y={y + 0.5}
            width={Math.max(0, cw - 1)}
            height={rh - 1}
            rx={2}
            style={{ fill: dangerMix(35) }}
          />,
        );
      }
      if (runSlots.has(slot)) {
        over.push(
          <g key={`r${d}.${h}`} className="rh-over">
            <Dot cx={x + cw / 2} cy={y + rh / 2} r={Math.min(3.5, cw / 4)} />
          </g>,
        );
      }
    }
  }

  const hourLabels = [0, 6, 12, 18].map((h) => (
    <text key={h} className="rh-t" x={gutter - 8} y={top + h * rh + rh / 2 + 3.5} textAnchor="end">
      {hh(h)}
    </text>
  ));

  // Day profile in the right margin.
  let marginMarks: ReactNode = null;
  if (!narrow && width > 0) {
    const px0 = gutter + mw + 22;
    const pp = width - px0 - 20;
    const mx = Math.max(...profile.wd, ...profile.we, 0.01);
    const xv = (value: number): number => px0 + (value / mx) * pp;
    const yc = (h: number): number => top + h * rh + rh / 2;
    const path = (values: readonly number[]): string =>
      values
        .map((value, h) => `${h === 0 ? "M" : "L"}${xv(value).toFixed(1)},${yc(h).toFixed(1)}`)
        .join("");
    marginMarks = (
      <g>
        <text className="rh-t rh-t2" x={px0} y={10}>
          Day profile
        </text>
        <text className="rh-t" x={px0} y={24}>
          {unitOf(account)}
        </text>
        <line className="rh-grid" x1={px0} x2={px0} y1={top} y2={top + mh} />
        <line className="rh-grid rh-dashed" x1={px0 + pp} x2={px0 + pp} y1={top} y2={top + mh} />
        <text className="rh-t" x={px0} y={top + mh + 13}>
          0
        </text>
        <text className="rh-t" x={px0 + pp} y={top + mh + 13} textAnchor="end">
          {mx.toFixed(1)}
        </text>
        <path className="rh-line rh-weekend-line" d={path(profile.we)} />
        <path className="rh-line" d={path(profile.wd)} />
        {[...runHours].map(([h, n]) => (
          <line
            key={`t${h}`}
            className="rh-tick"
            x1={width - 5 * n}
            x2={width}
            y1={yc(h)}
            y2={yc(h)}
          />
        ))}
        {Array.from({ length: 24 }, (_, h) => {
          const n = runHours.get(h) ?? 0;
          return (
            <rect
              key={`p${h}`}
              className="rh-hit"
              x={px0 - 6}
              y={top + h * rh}
              width={width - px0 + 6}
              height={rh}
              {...bind(
                `${hh(h)} on a typical day`,
                `Weekdays ${(profile.wd[h] ?? 0).toFixed(1)} · weekends ${(profile.we[h] ?? 0).toFixed(1)} ${unitShort(account)}${
                  n > 0 ? ` · ${plural(n, "run-out")}` : ""
                }`,
              )}
            />
          );
        })}
      </g>
    );
  }

  // One-row locked strip: with the lanes hidden, lockouts stay visible in All mode.
  let strip: ReactNode = null;
  if (account === null) {
    const sy = top + mh + 6;
    strip = (
      <g>
        <text
          className="rh-t"
          x={narrow ? 0 : gutter - 8}
          y={sy + 7}
          textAnchor={narrow ? "start" : "end"}
        >
          Locked
        </text>
        {Array.from({ length: columns }, (_, d) => {
          let locked = 0;
          let known = 0;
          for (let h = 0; h < 24; h += 1) {
            const slot = slotOf(series, atDay(d, h));
            if (!inRange(series, slot)) continue;
            known += 1;
            if (lockedAt(series, null, slot) > 0) locked += 1;
          }
          const x = gutter + d * cw;
          return (
            <g key={`s${d}`}>
              <rect
                className={locked > 0 ? "rh-strip-lock" : "rh-strip"}
                style={
                  locked > 0 ? { opacity: 0.25 + (0.75 * locked) / Math.max(1, known) } : undefined
                }
                x={x + 0.5}
                y={sy}
                width={Math.max(0, cw - 1)}
                height={8}
                rx={2}
              />
              {locked > 0 ? (
                <rect
                  className="rh-hit"
                  x={x + 0.5}
                  y={sy}
                  width={Math.max(0, cw - 1)}
                  height={8}
                  {...bind(fmtDay(atDay(d)), `${locked} of ${known} h with an account locked`)}
                />
              ) : null}
            </g>
          );
        })}
      </g>
    );
  }

  const height = top + mh + (account === null ? 20 : 8) + 4;
  const laneList =
    account === null
      ? series.accounts.toSorted((p, q) => averagePeak(q) - averagePeak(p))
      : [account];
  const aria = `Heatmap of ${account === null ? "accounts active" : `${account.label} usage`} by day and hour, 30 days. ${sm.big}. ${sm.cap}.`;
  const rampLabels =
    account === null ? rampCounts(series.accounts.length) : ["Quiet", "Even", "2x", "3x+"];
  const rampSteps = account === null ? [0, 1, 2, 3, 4] : [...ONE_LEVELS];

  return (
    <div className="rh-view">
      <CardTop
        headline={readout.headline}
        tools={<AccountFilter accounts={series.accounts} value={selected} onChange={setSelected} />}
      />
      <div className="rh-box" ref={box}>
        {width > 0 ? (
          <svg width={width} height={height} aria-label={aria}>
            {axis}
            {hourLabels}
            {cells}
            {over}
            {marginMarks}
            {strip}
          </svg>
        ) : null}
        {readout.tipNode}
      </div>
      <Legend>
        <span>{account === null ? "Accounts active" : "Hour vs. even pace"}</span>
        {rampSteps.map((step, index) => (
          <span key={step}>
            <Swatch kind="ramp" level={step} />
            {rampLabels[index]}
          </span>
        ))}
        <span>
          <Swatch kind="band" />
          Locked
        </span>
        <span>
          <Swatch kind="dot" />
          Ran out
        </span>
        <span>
          <Swatch kind="line" />
          Weekday
        </span>
        <span>
          <Swatch kind="dash" />
          Weekend
        </span>
        <span>Dotted: no reading.</span>
      </Legend>
      <section className="rh-windows" aria-label="Usage per window">
        <button
          type="button"
          className="rh-disclose"
          aria-expanded={lanes}
          onClick={() => setLanes(!lanes)}
        >
          <svg className="rh-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4 2.5 7.5 6 4 9.5" />
          </svg>
          <span className="rh-disclose-title">Usage per window</span>
          <span className="rh-disclose-hint">How full each limit window got</span>
        </button>
        {lanes && width > 0 ? (
          <WindowStrips
            accounts={laneList}
            from={day0}
            to={day0 + columns * day}
            left={gutter}
            plot={mw}
            width={width}
            narrow={narrow}
            bind={bind}
          />
        ) : null}
      </section>
    </div>
  );
}

/** The grey step for a window's peak, the same steps as the Plan Fit history. */
const windowLevel = (peak: number): number => (peak < 40 ? 1 : peak < 60 ? 2 : peak < 80 ? 3 : 4);

/**
 * Usage per window: one strip per account on the matrix's own day axis. Each window is a block over its real dates,
 * shaded by how full it got; a window that hit the limit is red, and the current one is outlined. Names sit in the
 * column to the right, under the day profile, so the strips line up with the days above them.
 */
function WindowStrips(props: {
  readonly accounts: readonly AccountSeries[];
  readonly from: number;
  readonly to: number;
  readonly left: number;
  readonly plot: number;
  readonly width: number;
  readonly narrow: boolean;
  readonly bind: (
    big: string,
    cap: string,
  ) => {
    readonly onPointerEnter: (event: PointerEvent) => void;
    readonly onPointerMove: (event: PointerEvent) => void;
    readonly onPointerLeave: () => void;
  };
}) {
  const rowH = 18;
  const nameH = props.narrow ? 16 : 0;
  const pitch = rowH + nameH + 8;
  const x = (at: number): number =>
    props.left +
    ((clamp(at, props.from, props.to) - props.from) / (props.to - props.from)) * props.plot;
  const height = props.accounts.length * pitch;
  return (
    <div className="rh-strips">
      <svg width={props.width} height={height} aria-hidden="true">
        {props.accounts.map((account, row) => {
          const y = row * pitch + nameH;
          return (
            <g key={account.id}>
              {props.narrow ? (
                <text className="rh-t rh-strip-name" x={props.left} y={y - 4}>
                  {account.label}
                </text>
              ) : null}
              {account.curves
                .filter((curve) => curve.end > props.from && curve.start < props.to)
                .map((curve) => {
                  const x1 = x(curve.start);
                  const x2 = x(curve.end);
                  const hit = curve.hitAt !== null;
                  const big = `${account.label} · ${fmtDay(curve.start)} to ${fmtDay(curve.end)}`;
                  const cap = `Peak ${Math.round(curve.peak)}%${curve.current ? " so far" : ""}${
                    curve.hitAt !== null && curve.lockEnd !== null
                      ? `, locked ${fmtHours((curve.lockEnd - curve.hitAt) / hour)}`
                      : ""
                  }`;
                  return (
                    <rect
                      key={curve.key}
                      className={
                        hit
                          ? "rh-win rh-win-hit"
                          : curve.current
                            ? "rh-win rh-win-now an2-cell"
                            : "rh-win an2-cell"
                      }
                      data-level={hit ? undefined : windowLevel(curve.peak)}
                      x={x1 + 1}
                      y={y}
                      width={Math.max(2, x2 - x1 - 2)}
                      height={rowH}
                      rx={3}
                      {...props.bind(big, cap)}
                    />
                  );
                })}
            </g>
          );
        })}
      </svg>
      {props.narrow ? null : (
        <div className="rh-strip-names" style={{ left: props.left + props.plot + 16 }}>
          {props.accounts.map((account) => (
            <span key={account.id} style={{ height: pitch }}>
              <BrandMark provider={account.story.provider} />
              <FullName name={account.label} />
            </span>
          ))}
        </div>
      )}
      <Legend>
        <span>Window peak</span>
        {[1, 2, 3, 4].map((step, index) => (
          <span key={step}>
            <Swatch kind="ramp" level={step} />
            {["Under 40%", "40-60%", "60-80%", "80-99%"][index]}
          </span>
        ))}
        <span>
          <i className="rh-sw-hit" aria-hidden="true" />
          Hit the limit
        </span>
        <span>
          <i className="rh-sw-now" aria-hidden="true" />
          This window
        </span>
      </Legend>
    </div>
  );
}

/* ------------------------------------------------------------------ Weeks */

function Weeks(props: { readonly series: Series }) {
  const { series } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const account = series.accounts.find((entry) => entry.id === selected) ?? null;
  const sm = useMemo(() => summary(series, account), [series, account]);
  const { day0 } = useMemo(() => calendarOf(series), [series]);

  const dayTotals = Array.from({ length: 7 }, () => 0);
  const dayCounts = Array.from({ length: 7 }, () => 0);
  for (let slot = 0; slot < slotCount; slot += 1) {
    const value = valueAt(series, account, slot);
    if (value === null) continue;
    const d = weekdayOf(slotTime(series, slot));
    dayTotals[d] = (dayTotals[d] ?? 0) + value;
    dayCounts[d] = (dayCounts[d] ?? 0) + 1;
  }
  let bestDay = 0;
  let bestMean = -1;
  dayTotals.forEach((total, d) => {
    const mean = total / Math.max(1, dayCounts[d] ?? 1);
    if (mean > bestMean) {
      bestMean = mean;
      bestDay = d;
    }
  });
  const base: Line = { big: `Busiest ${longDays[bestDay] ?? ""}, ${sm.band}`, cap: sm.cap };
  const readout = useReadout(base);
  const { bind, bindLazy } = readout;

  const narrow = width < 640;
  const left = narrow ? 48 : 90;
  const right = narrow ? 0 : 168;
  const px = left;
  const pw = Math.max(0, width - left - right - (narrow ? 0 : 6));
  const hw = pw / 168;

  const frame = (y: number, h: number): ReactNode => (
    <g>
      {Array.from({ length: 7 }, (_, d) => (
        <rect
          key={`n${d}`}
          className="rh-night"
          x={px + d * 24 * hw}
          y={y}
          width={8 * hw}
          height={h}
        />
      ))}
      {Array.from({ length: 8 }, (_, d) => (
        <line
          key={`g${d}`}
          className="rh-grid"
          x1={px + d * 24 * hw}
          x2={px + d * 24 * hw}
          y1={y}
          y2={y + h}
        />
      ))}
    </g>
  );

  // Typical week.
  const y0 = 20;
  const hT = 70;
  const tb = y0 + hT - 4;
  const tt = y0 + 6;
  const sums = Array.from({ length: 168 }, () => 0);
  const counts = Array.from({ length: 168 }, () => 0);
  for (let slot = 0; slot < slotCount; slot += 1) {
    const value = valueAt(series, account, slot);
    if (value === null) continue;
    const i = hourOfWeek(slotTime(series, slot));
    sums[i] = (sums[i] ?? 0) + value;
    counts[i] = (counts[i] ?? 0) + 1;
  }
  const avg = sums.map((sum, i) => ((counts[i] ?? 0) > 0 ? sum / (counts[i] ?? 1) : 0));
  const maxT = Math.max(...avg, 0.01);
  const yT = (value: number): number => tb - (value / maxT) * (tb - tt);
  const typical = avg
    .map(
      (value, i) =>
        `${i === 0 ? "M" : "L"}${(px + (i + 0.5) * hw).toFixed(1)},${yT(value).toFixed(1)}`,
    )
    .join("");

  // Week rows, Monday first.
  const start = new Date(day0);
  const firstMonday = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() - weekdayOf(day0),
  ).getTime();
  const rowH = 44;
  const pitch = 49;
  let maxV = 0.01;
  for (let slot = 0; slot < slotCount; slot += 1)
    maxV = Math.max(maxV, valueAt(series, account, slot) ?? 0);
  const runs = runsOf(series, account);
  const rows: ReactNode[] = [];
  let y = y0 + hT + 14;
  for (let ws = firstMonday; ws <= series.now;) {
    const wsDate = new Date(ws);
    const we = new Date(wsDate.getFullYear(), wsDate.getMonth(), wsDate.getDate() + 7).getTime();
    const rowTop = y;
    const baseY = rowTop + 38;
    const topY = rowTop + 4;
    const yv = (value: number): number => baseY - (value / maxV) * (baseY - topY);
    let area = "";
    let run: { i: number; v: number }[] = [];
    const flush = (): void => {
      const first = run[0];
      const last = run.at(-1);
      if (first !== undefined && last !== undefined) {
        area += `M${px + first.i * hw},${baseY}`;
        area += run
          .map(
            (p) =>
              `L${px + p.i * hw},${yv(p.v).toFixed(1)}L${px + (p.i + 1) * hw},${yv(p.v).toFixed(1)}`,
          )
          .join("");
        area += `L${px + (last.i + 1) * hw},${baseY}Z`;
      }
      run = [];
    };
    const locks: ReactNode[] = [];
    let lockRun: { i: number; j: number; c: number } | null = null;
    const flushLock = (): void => {
      if (lockRun === null) return;
      locks.push(
        <rect
          key={`k${lockRun.i}`}
          className="rh-lock"
          style={{ opacity: account !== null ? 1 : Math.min(1, 0.3 + 0.18 * lockRun.c) }}
          x={px + lockRun.i * hw}
          y={baseY + 1}
          width={(lockRun.j - lockRun.i) * hw}
          height={4}
        />,
      );
      lockRun = null;
    };
    let lockedHours = 0;
    const hits: ReactNode[] = [];
    for (let i = 0; i < 168; i += 1) {
      const at = ws + i * hour;
      const slot = slotOf(series, at);
      if (!inRange(series, slot)) {
        flush();
        flushLock();
        continue;
      }
      const value = valueAt(series, account, slot);
      if (value === null) flush();
      else run.push({ i, v: value });
      const c = lockedAt(series, account, slot);
      if (c > 0) {
        lockedHours += 1;
        if (lockRun !== null && lockRun.c === c && lockRun.j === i) lockRun.j = i + 1;
        else {
          flushLock();
          lockRun = { i, j: i + 1, c };
        }
      } else flushLock();
      hits.push(
        <rect
          key={`h${i}`}
          className="rh-g"
          x={px + i * hw}
          y={rowTop}
          width={hw}
          height={rowH}
          {...bindLazy(() => cellText(series, account, slot))}
        />,
      );
    }
    flush();
    flushLock();
    const rowRuns = runs.filter((r) => r.at >= ws && r.at < we);
    const gutterText =
      rowRuns.length > 0
        ? `${plural(rowRuns.length, "run-out")} · ${lockedHours} h locked`
        : lockedHours > 0
          ? `No run-outs · ${lockedHours} h locked`
          : "Quiet";
    rows.push(
      <g key={ws}>
        {frame(rowTop, rowH)}
        <line className="rh-grid" x1={px} x2={px + pw} y1={baseY} y2={baseY} />
        <text className="rh-t rh-t2" x={0} y={rowTop + 26}>
          {fmtDay(ws)}
        </text>
        <path className="rh-area" d={area} />
        {locks}
        {hits}
        {rowRuns.map((r) => {
          const x = px + ((r.at - ws) / hour) * hw;
          return (
            <g key={`o${r.accountId}${r.at}`}>
              <line className="rh-tick-line" x1={x} x2={x} y1={topY + 2} y2={baseY} />
              <Dot cx={x} cy={topY + 2} r={3.2} />
              <rect
                className="rh-g"
                x={x - 5}
                y={rowTop}
                width={10}
                height={rowH}
                {...bind(labelOf(series, r.accountId), runText(series, r))}
              />
            </g>
          );
        })}
        {narrow ? null : (
          <text
            className="rh-t rh-t2"
            data-strong={rowRuns.length > 0 || undefined}
            x={px + pw + 14}
            y={rowTop + 26}
          >
            {gutterText}
          </text>
        )}
      </g>,
    );
    y += pitch;
    ws = we;
  }

  const aria = `Typical week, then one row per week of ${account === null ? "accounts active" : `${account.label} usage`}. ${base.big}. ${sm.cap}.`;
  return (
    <div className="rh-view">
      <CardTop
        headline={readout.headline}
        tools={<AccountFilter accounts={series.accounts} value={selected} onChange={setSelected} />}
      />
      <div className="rh-box" ref={box}>
        {width > 0 ? (
          <svg width={width} height={y} aria-label={aria}>
            {weekdays.map((name, d) => (
              <text
                key={name}
                className="rh-t rh-t2"
                data-tone={d >= 5 ? "weekend" : undefined}
                x={px + (d * 24 + 12) * hw}
                y={10}
                textAnchor="middle"
              >
                {narrow ? name.slice(0, 1) : name}
              </text>
            ))}
            {frame(y0, hT)}
            <line className="rh-grid" x1={px} x2={px + pw} y1={tb} y2={tb} />
            <text className="rh-t rh-t2" x={0} y={y0 + 30}>
              {narrow ? "Typical" : "Typical week"}
            </text>
            {narrow ? null : (
              <text className="rh-t" x={0} y={y0 + 44}>
                avg per hour
              </text>
            )}
            <path
              className="rh-area-soft"
              d={`${typical}L${px + pw - hw / 2},${tb}L${px + hw / 2},${tb}Z`}
            />
            <path className="rh-line" d={typical} />
            {avg.map((value, i) => (
              <rect
                key={typicalKey(i)}
                className="rh-g"
                x={px + i * hw}
                y={y0}
                width={hw}
                height={hT}
                {...bind(
                  `${weekdays[Math.floor(i / 24)] ?? ""} ${hh(i % 24)} in a typical week`,
                  `${value.toFixed(1)} ${unitShort(account)} · avg of ${plural(counts[i] ?? 0, "week")}`,
                )}
              />
            ))}
            {narrow ? null : (
              <g>
                <text className="rh-t rh-t2" x={px + pw + 14} y={y0 + 30}>
                  Peak {maxT.toFixed(1)} {unitShort(account)}
                </text>
                <text className="rh-t" x={px + pw + 14} y={y0 + 44}>
                  Mean of {Math.round((slotCount / 168) * 10) / 10} weeks
                </text>
              </g>
            )}
            {rows}
          </svg>
        ) : null}
        {readout.tipNode}
      </div>
      <Legend>
        <span>
          <Swatch kind="fill" />
          {account === null ? "Accounts active per hour" : "pp used per hour"}
        </span>
        <span>
          <Swatch kind="lock" />
          Locked{account === null ? " (darker: more accounts)" : ""}
        </span>
        <span>
          <Swatch kind="dot" />
          Ran out
        </span>
        <span>
          <Swatch kind="ramp" level={0} />
          Night, 00-07
        </span>
        <span>
          <Swatch kind="line" />
          Typical week
        </span>
      </Legend>
    </div>
  );
}

/* ------------------------------------------------------------------ Range */

/** A label cut to `max` characters, for a narrow column. */
const shorten = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const typicalKey = (i: number): string => `t${weekdays[Math.floor(i / 24)] ?? ""}${i % 24}`;
const rangeDays = slotCount / 24;
const fixed = (value: number | null): string => (value === null ? "none" : value.toFixed(1));

function rangeStats(
  series: Series,
  selected: ReadonlySet<string>,
  range: readonly [number, number],
) {
  const chosen = series.accounts.filter((entry) => selected.has(entry.id));
  const k0 = range[0] * 24;
  const k1 = Math.min(slotCount, (range[1] + 1) * 24);
  const single = chosen.length === 1 ? (chosen[0] ?? null) : null;
  const sum = Array.from({ length: 168 }, () => 0);
  const occ = Array.from({ length: 168 }, () => 0);
  const out = Array.from({ length: 168 }, () => 0);
  for (let slot = k0; slot < k1; slot += 1) {
    const at = slotTime(series, slot);
    const i = weekdayOf(at) * 24 + hourOf(at);
    if (single !== null) {
      // A locked or unread hour is unknown, not zero.
      const value = single.hourly[slot] ?? null;
      if (single.locked[slot] === true || value === null) continue;
      occ[i] = (occ[i] ?? 0) + 1;
      sum[i] = (sum[i] ?? 0) + value / single.evenHour;
    } else {
      occ[i] = (occ[i] ?? 0) + 1;
      let n = 0;
      for (const entry of chosen) {
        const value = entry.hourly[slot] ?? null;
        if (value !== null && value >= entry.evenHour) n += 1;
      }
      sum[i] = (sum[i] ?? 0) + n;
    }
  }
  const outs = series.runouts.filter(
    (run) =>
      selected.has(run.accountId) &&
      run.at >= slotTime(series, k0) &&
      run.at < slotTime(series, k1),
  );
  for (const run of outs) {
    const i = weekdayOf(run.at) * 24 + hourOf(run.at);
    out[i] = (out[i] ?? 0) + 1;
  }
  const values = sum.map((total, i) => ((occ[i] ?? 0) > 0 ? total / (occ[i] ?? 1) : null));
  const known = values.filter((value): value is number => value !== null);
  const max = known.length > 0 ? Math.max(...known) : 0;
  let best = -1;
  values.forEach((value, i) => {
    if (value !== null && (best < 0 || value > (values[best] ?? 0))) best = i;
  });
  const profile = (daysList: readonly number[]): (number | null)[] =>
    Array.from({ length: 24 }, (_, h) => {
      const list = daysList
        .map((d) => values[d * 24 + h] ?? null)
        .filter((value): value is number => value !== null);
      return list.length > 0 ? list.reduce((total, value) => total + value, 0) / list.length : null;
    });
  return {
    chosen,
    single,
    k0,
    k1,
    values,
    max,
    best,
    out,
    outs,
    wk: profile([0, 1, 2, 3, 4]),
    we: profile([5, 6]),
  };
}

function RangeView(props: { readonly series: Series }) {
  const { series } = props;
  const everyone = useMemo(() => new Set(series.accounts.map((entry) => entry.id)), [series]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(everyone);
  const [range, setRange] = useState<readonly [number, number]>([rangeDays - 14, rangeDays - 1]);
  const anchor = useRef<number | null>(null);
  const split = useRef<HTMLDivElement>(null);
  const leftBox = useRef<HTMLDivElement>(null);
  const panelBox = useRef<HTMLDivElement>(null);
  const wl = useWidth(leftBox);
  const wr = useWidth(panelBox);
  const stats = useMemo(() => rangeStats(series, selected, range), [series, selected, range]);
  const list = useMemo(
    () => series.accounts.toSorted((p, q) => averagePeak(q) - averagePeak(p)),
    [series],
  );

  const rangeText = `${fmtDay(series.from + range[0] * day)} - ${fmtDay(series.from + range[1] * day)}`;
  const who = stats.single !== null ? stats.single.label : `${stats.chosen.length} accounts`;
  const baseBig =
    stats.best < 0
      ? "No activity in range"
      : `Busiest ${weekdays[Math.floor(stats.best / 24)] ?? ""} ${hh(stats.best % 24)}`;
  const baseCap =
    stats.best < 0 ? `${who} · ${rangeText}` : `${plural(stats.outs.length, "run-out")} in range`;
  const base: Line = { big: baseBig, cap: baseCap };
  const readout = useReadout(base);
  const { bind } = readout;

  // Lanes and brush.
  const gutter = wl < 520 ? 110 : 150;
  const plotWidth = Math.max(0, wl - gutter);
  const laneHeight = 28;
  const pitch = laneHeight + 8;
  const lanesHeight = list.length * pitch - 8;
  const to = series.from + slotCount * hour;
  const xd = (d: number): number => (Math.min(slotCount, d * 24) / slotCount) * plotWidth;
  const dayAt = (event: PointerEvent<SVGSVGElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    return clamp(
      Math.floor(((event.clientX - rect.left) / Math.max(1, plotWidth)) * rangeDays),
      0,
      rangeDays - 1,
    );
  };
  const laneText = (entry: AccountSeries): string => {
    const nOut = series.runouts.filter(
      (run) =>
        run.accountId === entry.id &&
        run.at >= slotTime(series, stats.k0) &&
        run.at < slotTime(series, stats.k1),
    ).length;
    let lockedHours = 0;
    for (let slot = stats.k0; slot < stats.k1; slot += 1)
      if (entry.locked[slot] === true) lockedHours += 1;
    return `Avg peak ${Math.round(averagePeak(entry))}% · locked ${lockedHours} h · ${plural(nOut, "run-out")} in range`;
  };
  const edgeNear = (px: number): boolean =>
    Math.abs(px - xd(range[0])) < 7 || Math.abs(px - xd(range[1] + 1)) < 7;

  const onDown = (event: PointerEvent<SVGSVGElement>): void => {
    const px = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const d = dayAt(event);
    if (Math.abs(px - xd(range[0])) < 7) anchor.current = range[1];
    else if (Math.abs(px - xd(range[1] + 1)) < 7) anchor.current = range[0];
    else {
      anchor.current = d;
      setRange([d, d]);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    readout.leave();
    event.preventDefault();
  };
  const onMove = (event: PointerEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    if (anchor.current === null) {
      event.currentTarget.style.cursor = edgeNear(px) ? "col-resize" : "crosshair";
      const row = Math.floor((event.clientY - rect.top) / pitch);
      const entry = list[row];
      if (entry === undefined || (event.clientY - rect.top) % pitch > laneHeight) readout.leave();
      else readout.at(event, entry.label, laneText(entry));
      return;
    }
    const d = dayAt(event);
    setRange([Math.min(anchor.current, d), Math.max(anchor.current, d)]);
  };
  const onUp = (): void => {
    anchor.current = null;
  };
  const pick = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next.size === 0 ? everyone : next);
  };
  const dimmed = useMemo(
    () =>
      new Set(series.accounts.filter((entry) => !selected.has(entry.id)).map((entry) => entry.id)),
    [series, selected],
  );

  // Heatmap and day profile.
  const lead = 30;
  const cellW = Math.max(0, (wr - lead) / 24);
  // Rows stay readable even when 24 columns make the cells narrow; the panel has the height to spare.
  const cellH = 18;
  const rowGap = cellH + 2;
  const heatTop = 16;
  const heatBottom = heatTop + 7 * rowGap;
  const profTop = heatBottom + 14;
  const profH = 70;
  const profBase = profTop + profH;
  const heatHeight = profBase + 34;
  const unit = stats.single !== null ? "× its even pace" : "accounts active on average";
  const profMax = Math.max(
    0.0001,
    ...stats.wk.filter((value): value is number => value !== null),
    ...stats.we.filter((value): value is number => value !== null),
  );
  const xc = (h: number): number => lead + h * cellW + cellW / 2;
  const yp = (value: number): number => profBase - (value / profMax) * (profH - 6);
  const path = (values: readonly (number | null)[]): string =>
    values
      .map((value, i) =>
        value === null
          ? ""
          : `${values[i - 1] === undefined || values[i - 1] === null ? "M" : "L"}${xc(i).toFixed(1)},${yp(value).toFixed(1)}`,
      )
      .join("");

  const aria = `Weekday by hour heatmap of ${who}, ${rangeText}. ${baseBig}. ${baseCap}.`;
  const allOn = selected.size === series.accounts.length;
  const axisStep = plotWidth < 420 ? 10 : 5;
  const axisDays = Array.from({ length: rangeDays / axisStep }, (_, i) => i * axisStep);

  return (
    <div className="an2-split rh-split" ref={split}>
      <div className="rh-left" ref={leftBox}>
        <div className="rh-top">
          <div className="an2-ro">
            <p className="an2-ro-big">{rangeText}</p>
            <p className="an2-ro-cap">{who} · drag across the lanes to change the range</p>
          </div>
          <fieldset className="seg" aria-label="Accounts in range">
            <button type="button" aria-pressed={allOn} onClick={() => setSelected(everyone)}>
              All Accounts
            </button>
          </fieldset>
        </div>
        {wl > 0 ? (
          <div className="rh-lanes">
            <svg
              className="rh-axis"
              width={plotWidth}
              height={18}
              style={{ marginLeft: gutter }}
              aria-hidden="true"
            >
              {axisDays.map((d) => (
                <text key={d} className="rh-t" x={xd(d)} y={12}>
                  {fmtDay(series.from + d * day)}
                </text>
              ))}
              <text className="rh-t" x={plotWidth} y={12} textAnchor="end">
                Today
              </text>
            </svg>
            <div className="rh-body">
              <UsageLanes
                accounts={list}
                from={series.from}
                to={to}
                width={wl}
                gutter={gutter}
                laneHeight={laneHeight}
                dimmed={dimmed}
                onPickAccount={pick}
              />
              <svg
                className="rh-brush"
                width={plotWidth}
                height={lanesHeight}
                style={{ left: gutter }}
                aria-hidden="true"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onPointerLeave={readout.leave}
              >
                <rect width={plotWidth} height={lanesHeight} fill="transparent" />
                <rect
                  className="rh-selection"
                  x={xd(range[0])}
                  y={0}
                  width={xd(range[1] + 1) - xd(range[0])}
                  height={lanesHeight}
                />
                {[xd(range[0]), xd(range[1] + 1)].map((x) => (
                  <g key={x}>
                    <line className="rh-edge" x1={x} x2={x} y1={0} y2={lanesHeight} />
                    <rect
                      className="rh-handle"
                      x={x - 3}
                      y={lanesHeight / 2 - 9}
                      width={6}
                      height={18}
                      rx={3}
                    />
                  </g>
                ))}
              </svg>
            </div>
          </div>
        ) : null}
        <Legend>
          <span>
            <Swatch kind="fill" />
            Window filling
          </span>
          <span>
            <Swatch kind="lock" />
            Locked
          </span>
          <span>
            <Swatch kind="ramp" level={1} />
            Selected days
          </span>
          <span>Click a name to toggle it.</span>
        </Legend>
      </div>
      <div className="an2-panel" ref={panelBox}>
        <CardTop headline={readout.headline} />
        {wr > 0 ? (
          <svg width={wr} height={heatHeight} aria-label={aria}>
            {[0, 6, 12, 18].map((h) => (
              <text key={h} className="rh-t" x={lead + h * cellW + 1} y={10}>
                {hh(h).slice(0, 2)}
              </text>
            ))}
            {weekdays.map((name, d) => (
              <g key={name}>
                <text className="rh-t" x={0} y={heatTop + d * rowGap + cellH - 5}>
                  {name}
                </text>
                {Array.from({ length: 24 }, (_, h) => {
                  const i = d * 24 + h;
                  const value = stats.values[i] ?? null;
                  const cx = lead + h * cellW + 1;
                  const cy = heatTop + d * rowGap;
                  if (value === null) {
                    return (
                      <rect
                        key={h}
                        className="rh-cell rh-unknown"
                        x={cx}
                        y={cy}
                        width={Math.max(0, cellW - 2)}
                        height={cellH}
                        rx={3}
                        {...bind(`${name} ${hh(h)}`, "No known hour")}
                      />
                    );
                  }
                  const n = stats.out[i] ?? 0;
                  return (
                    <g key={h}>
                      <rect
                        className="rh-cell"
                        x={cx}
                        y={cy}
                        width={Math.max(0, cellW - 2)}
                        height={cellH}
                        rx={3}
                        style={{ fill: shareFill(stats.max > 0 ? value / stats.max : 0) }}
                        {...bind(
                          `${name} ${hh(h)}`,
                          `${value.toFixed(1)} ${unit}${n > 0 ? ` · ${plural(n, "run-out")}` : ""}`,
                        )}
                      />
                      {n > 0 ? (
                        <g className="rh-over">
                          <Dot
                            cx={cx + (cellW - 2) / 2}
                            cy={cy + cellH / 2}
                            r={Math.min(3.5, cellH / 4 + 1)}
                          />
                        </g>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            ))}
            <line
              className="rh-grid"
              x1={lead}
              x2={lead + 24 * cellW}
              y1={profBase}
              y2={profBase}
            />
            <line
              className="rh-grid rh-dashed"
              x1={lead}
              x2={lead + 24 * cellW}
              y1={yp(profMax)}
              y2={yp(profMax)}
            />
            <text className="rh-t" x={lead - 4} y={yp(profMax) + 4} textAnchor="end">
              {profMax.toFixed(1)}
            </text>
            <text className="rh-t" x={lead - 4} y={profBase + 3} textAnchor="end">
              0
            </text>
            {stats.wk.every((value) => value !== null) ? (
              <path
                className="rh-area-soft"
                d={`${path(stats.wk)}L${xc(23)},${profBase}L${xc(0)},${profBase}Z`}
              />
            ) : null}
            <path className="rh-line rh-weekend-line" d={path(stats.we)} />
            <path className="rh-line" d={path(stats.wk)} />
            {[0, 6, 12, 18, 23].map((h) => (
              <text
                key={h}
                className="rh-t"
                x={xc(h)}
                y={profBase + 28}
                textAnchor={h === 0 ? "start" : h === 23 ? "end" : "middle"}
              >
                {hh(h)}
              </text>
            ))}
            {stats.outs.map((run) => {
              const x = lead + (hourOf(run.at) + new Date(run.at).getMinutes() / 60) * cellW;
              return (
                <line
                  key={`${run.accountId}${run.at}`}
                  className="rh-tick"
                  x1={x}
                  x2={x}
                  y1={profBase + 3}
                  y2={profBase + 12}
                  {...bind(labelOf(series, run.accountId), `Ran out ${fmtTime(run.at)}`)}
                />
              );
            })}
            {Array.from({ length: 24 }, (_, h) => (
              <rect
                key={`p${h}`}
                className="rh-hit"
                x={lead + h * cellW}
                y={profTop}
                width={cellW}
                height={profH}
                {...bind(
                  hh(h),
                  `Weekday ${fixed(stats.wk[h] ?? null)} · weekend ${fixed(stats.we[h] ?? null)} ${unit}`,
                )}
              />
            ))}
          </svg>
        ) : null}
        <Legend>
          <span>
            {stats.single !== null ? "Quiet" : "Few active"}
            {[0, 0.25, 0.5, 0.75, 1].map((q) => (
              <i
                key={q}
                className="an2-sw"
                style={{ background: shareFill(q) }}
                aria-hidden="true"
              />
            ))}
            {stats.single !== null ? "Fastest" : "Most active"}
          </span>
          <span>
            <Swatch kind="dot" />
            Ran out
          </span>
          <span>
            <Swatch kind="line" />
            Weekday
          </span>
          <span>
            <Swatch kind="dash" />
            Weekend
          </span>
          <span>Dotted: no known hour.</span>
        </Legend>
      </div>
      {readout.tipNode}
    </div>
  );
}

/* ------------------------------------------------------------- By account */

type Mode = "wd" | "we" | "all";
const modes = [
  { value: "wd", label: "Weekdays" },
  { value: "we", label: "Weekends" },
  { value: "all", label: "All days" },
] as const satisfies readonly { readonly value: Mode; readonly label: string }[];
const modeText: Record<Mode, string> = { all: "all days", wd: "weekdays", we: "weekends" };

function ByAccount(props: { readonly series: Series }) {
  const { series } = props;
  const [mode, setMode] = useState<Mode>("all");
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const narrow = width < 520;
  const left = narrow ? 108 : 160;
  const right = narrow ? 68 : 104;
  const cols = Math.max(0, width - left - right);
  const cw = cols / 24;

  const model = useMemo(() => {
    const keep = (at: number): boolean => mode === "all" || weekdayOf(at) >= 5 === (mode === "we");
    const rows = series.accounts
      .map((account) => {
        const sum = Array.from({ length: 24 }, () => 0);
        const n = Array.from({ length: 24 }, () => 0);
        const slots = Array.from({ length: 24 }, () => 0);
        const locked = Array.from({ length: 24 }, () => 0);
        for (let slot = 0; slot < slotCount; slot += 1) {
          const at = slotTime(series, slot);
          if (!keep(at)) continue;
          const h = hourOf(at);
          slots[h] = (slots[h] ?? 0) + 1;
          // A locked or unread hour is unknown, not zero, so it stays out of the mean.
          if (account.locked[slot] === true) {
            locked[h] = (locked[h] ?? 0) + 1;
            continue;
          }
          const value = account.hourly[slot] ?? null;
          if (value === null) continue;
          n[h] = (n[h] ?? 0) + 1;
          sum[h] = (sum[h] ?? 0) + value;
        }
        const mean = sum.map((total, h) => ((n[h] ?? 0) > 0 ? total / (n[h] ?? 1) : null));
        const max = Math.max(0, ...mean.filter((value): value is number => value !== null));
        const outs = Array.from({ length: 24 }, () => 0);
        for (const run of series.runouts) {
          if (run.accountId === account.id && keep(run.at))
            outs[hourOf(run.at)] = (outs[hourOf(run.at)] ?? 0) + 1;
        }
        const peakHour = argMax(mean);
        return {
          account,
          share: mean.map((value) => (value === null ? null : max > 0 ? value / max : 0)),
          lockFrac: locked.map((value, h) => ((slots[h] ?? 0) > 0 ? value / (slots[h] ?? 1) : 0)),
          outs,
          total: lockedTotal(account),
          peakHour,
          peak: averagePeak(account),
        };
      })
      .toSorted((p, q) => q.total - p.total || q.peak - p.peak);
    const avg = Array.from({ length: 24 }, (_, h) => {
      let total = 0;
      let count = 0;
      for (let slot = 0; slot < slotCount; slot += 1) {
        const at = slotTime(series, slot);
        if (keep(at) && hourOf(at) === h) {
          total += series.active[slot] ?? 0;
          count += 1;
        }
      }
      return count > 0 ? total / count : 0;
    });
    return { rows, avg };
  }, [series, mode]);

  const { rows, avg } = model;
  const spanText = (hoursList: readonly number[]): string => {
    const parts: string[] = [];
    let begin: number | null = null;
    for (let h = 0; h <= 24; h += 1) {
      const on = h < 24 && hoursList.includes(h);
      if (on && begin === null) begin = h;
      if (!on && begin !== null) {
        parts.push(`${hh(begin)}-${hh(h)}`);
        begin = null;
      }
    }
    return parts.join(" and ");
  };
  const worst = rows
    .map((row) => ({ row, n: row.outs.reduce((total, value) => total + value, 0) }))
    .toSorted((p, q) => q.n - p.n)[0];
  const outHours =
    worst !== undefined && worst.n > 0
      ? worst.row.outs.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0)
      : [];
  const first =
    worst !== undefined && worst.n > 0
      ? `${worst.row.account.label} runs out around ${hh(Math.min(...outHours))}-${hh(Math.max(...outHours) + 1)}`
      : `No account ran out on ${modeText[mode]}`;
  const counts = Array.from(
    { length: 24 },
    (_, h) => rows.filter((row) => (row.share[h] ?? 0) >= 0.75 && row.share[h] !== null).length,
  );
  const maxCount = Math.max(...counts);
  const peakHours = counts
    .map((value, h) => (maxCount > 0 && value >= Math.max(1, Math.ceil(maxCount * 0.75)) ? h : -1))
    .filter((h) => h >= 0);
  const baseCap =
    peakHours.length > 0 ? `Most accounts peak ${spanText(peakHours)}` : "No clear shared peak";
  const base: Line = { big: first, cap: baseCap };
  const readout = useReadout(base);
  const { bind } = readout;

  const avgMax = Math.max(0.0001, ...avg);
  const aTop = 6;
  const aH = 64;
  const aBase = aTop + aH;
  const xc = (h: number): number => left + h * cw + cw / 2;
  const ya = (value: number): number => aBase - (value / avgMax) * (aH - 8);
  const line = avg
    .map((value, h) => `${h === 0 ? "M" : "L"}${xc(h).toFixed(1)},${ya(value).toFixed(1)}`)
    .join("");
  const hy = aBase + 22;
  const rowH = 26;
  const ch = 20;
  const height = hy + rows.length * rowH + 2;
  const aria = `Average use by hour on ${modeText[mode]}. Each row has its own scale. ${first}. ${baseCap}.`;

  return (
    <div className="rh-view">
      <CardTop
        headline={readout.headline}
        tools={<Segmented label="Days" value={mode} onChange={setMode} options={modes} />}
      />
      <div className="rh-box" ref={box}>
        {width > 0 ? (
          <svg width={width} height={height} aria-label={aria}>
            <line className="rh-grid" x1={left} x2={left + cols} y1={aBase} y2={aBase} />
            <line
              className="rh-grid rh-dashed"
              x1={left}
              x2={left + cols}
              y1={ya(avgMax)}
              y2={ya(avgMax)}
            />
            <path className="rh-area-soft" d={`${line}L${xc(23)},${aBase}L${xc(0)},${aBase}Z`} />
            <path className="rh-line" d={line} />
            <text className="rh-t rh-t3" x={0} y={aTop + 22}>
              All accounts
            </text>
            <text className="rh-t" x={0} y={aTop + 38}>
              Average active
            </text>
            {narrow ? null : (
              <g>
                <text className="rh-t rh-t2" x={left + cols + 10} y={aTop + 22}>
                  Peak {avgMax.toFixed(1)}
                </text>
                <text className="rh-t" x={left + cols + 10} y={aTop + 38}>
                  accounts active
                </text>
              </g>
            )}
            {avg.map((value, h) => (
              <rect
                key={`a${hh(h)}`}
                className="rh-hit"
                x={left + h * cw}
                y={aTop}
                width={cw}
                height={aH}
                {...bind(
                  `${hh(h)}, all accounts`,
                  `${value.toFixed(1)} accounts active on average (${modeText[mode]})`,
                )}
              />
            ))}
            {[0, 6, 12, 18].map((h) => (
              <text key={h} className="rh-t" x={left + h * cw + 1} y={hy - 8}>
                {hh(h)}
              </text>
            ))}
            {narrow ? null : (
              <text className="rh-t" x={left + cols} y={hy - 8} textAnchor="end">
                24:00
              </text>
            )}
            {rows.map((row, i) => {
              const y = hy + i * rowH;
              const rowCap = `${row.peakHour < 0 ? "No data" : `Busiest hour ${hh(row.peakHour)}`} · ${
                row.total > 0 ? `locked ${row.total} h in 30 days` : "never locked"
              }`;
              return (
                <g key={row.account.id}>
                  <Mark account={row.account} x={0} y={y + ch / 2 - 7} />
                  <text className="rh-t rh-t2" x={20} y={y + ch / 2 + 4}>
                    {narrow ? shorten(row.account.label, 12) : row.account.label}
                  </text>
                  <text
                    className="rh-t rh-t2"
                    data-strong={row.total > 0 || undefined}
                    x={width}
                    y={y + ch / 2 + 4}
                    textAnchor="end"
                  >
                    {row.total > 0 ? `Locked ${row.total} h` : "Never locked"}
                  </text>
                  <rect
                    className="rh-hit"
                    x={0}
                    y={y}
                    width={left - 4}
                    height={rowH}
                    {...bind(row.account.label, rowCap)}
                  />
                  {Array.from({ length: 24 }, (_, h) => {
                    const share = row.share[h] ?? null;
                    const cx = left + h * cw + 1;
                    const nOut = row.outs[h] ?? 0;
                    const lockFrac = row.lockFrac[h] ?? 0;
                    const often = lockFrac >= 0.05;
                    const bits = [
                      share === null
                        ? "No known hour"
                        : `${Math.round(share * 100)}% of its busiest hour`,
                      nOut > 0 ? plural(nOut, "run-out") : "",
                      often ? `locked ${Math.round(lockFrac * 100)}% of the time` : "",
                    ].filter((bit) => bit !== "");
                    return (
                      <g key={h}>
                        <rect
                          className={share === null ? "rh-cell rh-unknown" : "rh-cell"}
                          style={share === null ? undefined : { fill: shareFill(share) }}
                          x={cx}
                          y={y}
                          width={Math.max(0, cw - 2)}
                          height={ch}
                          rx={3}
                          {...bind(`${row.account.label} at ${hh(h)}`, bits.join(" · "))}
                        />
                        {nOut > 0 ? (
                          <g className="rh-over">
                            <Dot
                              cx={cx + (cw - 2) / 2}
                              cy={y + ch / 2}
                              r={Math.min(3.5, ch / 4 + 1)}
                            />
                          </g>
                        ) : null}
                        {often ? (
                          <rect
                            className="rh-lock rh-over"
                            style={{ opacity: Math.min(1, 0.35 + lockFrac * 3) }}
                            x={cx}
                            y={y + ch + 1}
                            width={Math.max(0, cw - 2)}
                            height={2}
                            rx={1}
                          />
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        ) : null}
        {readout.tipNode}
      </div>
      <Legend>
        <span>
          Quiet
          {[0, 0.25, 0.5, 0.75, 1].map((q) => (
            <i key={q} className="an2-sw" style={{ background: shareFill(q) }} aria-hidden="true" />
          ))}
          Busiest hour
        </span>
        <span>Each row has its own scale.</span>
        <span>
          <Swatch kind="dot" />
          Ran out
        </span>
        <span>
          <Swatch kind="lock" />
          Locked (darker: more often)
        </span>
        <span>Averages skip locked hours. Dotted: no known hour.</span>
        <span>Top row counts accounts, not percentages.</span>
      </Legend>
    </div>
  );
}

const span = (low: number, high: number): string => (low >= high ? `${high}` : `${low}-${high}`);

/** Legend words for the All Accounts ramp: the account counts each step covers. */
function rampCounts(total: number): string[] {
  const edge = (share: number): number => Math.floor(share * total);
  return [
    "0",
    span(1, Math.max(1, edge(0.2))),
    span(edge(0.2) + 1, edge(0.4)),
    span(edge(0.4) + 1, edge(0.6)),
    `${edge(0.6) + 1}+`,
  ];
}
