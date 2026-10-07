import type { CSSProperties } from "react";

import { useNow } from "../../lib/now.ts";
import { LoadingNote, Sk } from "../../ui/skeleton.tsx";
import { DayLabel } from "./day-label.tsx";
import { axisFor, columnOf, positionOf, rangeLabel, weekday } from "./range.ts";
// The skeleton is the Suspense fallback while this view's code loads, so its styles ship with the first screen.
import "./timeline.css";

/** A ghost bar: the real window shapes, with the text left to a placeholder. */
interface Ghost {
  readonly variant: "prev" | "cur" | "next";
  readonly left: number;
  readonly width: number;
  readonly cutEnd?: boolean;
}

// Three groups of accounts, each with the bars one lane typically has: the earlier window, the current one, the next.
const groups: readonly { readonly id: string; readonly lanes: readonly (readonly Ghost[])[] }[] = [
  {
    id: "first",
    lanes: [
      [
        { variant: "prev", left: 0, width: 36 },
        { variant: "cur", left: 36, width: 50 },
        { variant: "next", left: 86, width: 14, cutEnd: true },
      ],
      [
        { variant: "prev", left: 0, width: 18 },
        { variant: "cur", left: 18, width: 50 },
        { variant: "next", left: 68, width: 32, cutEnd: true },
      ],
    ],
  },
  {
    id: "second",
    lanes: [
      [
        { variant: "prev", left: 0, width: 25 },
        { variant: "cur", left: 25, width: 50 },
        { variant: "next", left: 75, width: 25, cutEnd: true },
      ],
    ],
  },
];

function Chevron(props: { readonly direction: "left" | "right" }) {
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
      <path d={props.direction === "left" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
    </svg>
  );
}

function GhostBar(props: { readonly ghost: Ghost }) {
  const { ghost } = props;
  const style: CSSProperties = { left: `${ghost.left}%`, width: `${ghost.width}%` };
  return (
    <span
      className={`tl-win tl-${ghost.variant}${ghost.cutEnd === true ? " tl-cut-r" : ""}`}
      style={style}
    >
      <span className="tl-txt">
        <Sk kind="text" width={ghost.variant === "cur" ? 96 : 56} />
      </span>
      {ghost.variant === "cur" ? <span className="tl-strip" /> : null}
    </span>
  );
}

function GroupGhost() {
  return (
    <div className="tl-grp">
      <Sk width={20} height={20} className="sk-pill" />
      <b>
        <Sk kind="text" width={64} />
      </b>
      <span>
        <Sk kind="text" width={64} />
      </span>
    </div>
  );
}

/** Name, identity and limit chips of one account. */
function WhoGhost() {
  return (
    <div className="tl-who-cell">
      <div className="tl-id">
        <span className="tl-nm">
          <Sk kind="text" width={140} />
        </span>
      </div>
      <div className="who tl-ident">
        <Sk kind="text" width={150} />
      </div>
      <div className="tl-chips">
        <Sk width={92} height={22} className="sk-pill" />
        <Sk width={84} height={22} className="sk-pill" />
      </div>
    </div>
  );
}

function ItemsGhost(props: { readonly count: number }) {
  return (
    <ul>
      {Array.from({ length: props.count }, (_, row) => (
        <li key={row}>
          <Sk width={20} height={20} className="sk-pill" />
          <span className="tl-what">
            <b>
              <Sk kind="text" width={130} />
            </b>
            <span>
              <Sk kind="text" width={96} />
            </span>
          </span>
          <span className="tl-when">
            <b>
              <Sk kind="text" width={48} />
            </b>
            <span>
              <Sk kind="text" width={64} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The Timeline before the overview loads, as a ghost of the real page. The week axis and the controls show for
 * real, on the range the page opens with; accounts, limits and bars are placeholders in the real boxes.
 */
export function TimelineSkeleton() {
  const now = useNow();
  const axis = axisFor("weekly", now, 0);
  const nowX = positionOf(axis, now);
  const nowColumn = columnOf(axis, now);
  const gridStyle: CSSProperties & Record<string, string> = {
    "--cols": String(axis.columns.length),
  };
  return (
    <div className="tl-view tl-sk" aria-busy="true">
      <LoadingNote>Loading timeline</LoadingNote>
      <div className="tl-tools" aria-hidden="true">
        <h2 className="tl-range">{rangeLabel(axis)}</h2>
        <div className="tl-ctl">
          <fieldset className="tl-step" inert>
            <button type="button" tabIndex={-1}>
              <Chevron direction="left" />
            </button>
            <button type="button" tabIndex={-1} className="tl-today-button" aria-disabled="true">
              Today
            </button>
            <button type="button" tabIndex={-1}>
              <Chevron direction="right" />
            </button>
          </fieldset>
          <fieldset className="seg" inert>
            <button type="button" tabIndex={-1} aria-pressed="true">
              Weekly
            </button>
            <button type="button" tabIndex={-1}>
              5-Hour
            </button>
            <button type="button" tabIndex={-1}>
              Cycle
            </button>
          </fieldset>
          <fieldset className="seg" inert>
            <button type="button" tabIndex={-1}>
              Used
            </button>
            <button type="button" tabIndex={-1}>
              Left
            </button>
          </fieldset>
        </div>
      </div>

      <section className="tl-chart" aria-hidden="true">
        <div className="tl-grid" style={gridStyle}>
          <div className="tl-hrow">
            <div className="tl-corner">
              Account
              <span>
                Limits · <Sk kind="text" width={32} />
              </span>
            </div>
            <div className="tl-cols">
              {axis.columns.map((start, column) => (
                <div key={start} className={nowColumn === column ? "tl-col tl-today" : "tl-col"}>
                  <span>{weekday(start)}</span>
                  <b>
                    <DayLabel t={start} />
                  </b>
                </div>
              ))}
            </div>
          </div>
          {groups.map((group) => (
            <div key={group.id} className="tl-set">
              <GroupGhost />
              {group.lanes.map((bars) => (
                <div key={bars[1]?.left} className="tl-row">
                  <WhoGhost />
                  <div className="tl-track">
                    <div className="tl-bars">
                      {bars.map((ghost) => (
                        <GhostBar key={ghost.variant} ghost={ghost} />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="tl-plot">
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
      </section>

      <section className="tl-list" aria-hidden="true">
        <div className="tl-lists">
          {groups.map((group) => (
            <div key={group.id} className="tl-set">
              <GroupGhost />
              {group.lanes.map((bars) => (
                <div key={bars[1]?.left} className="tl-mrow">
                  <WhoGhost />
                  <div className="tl-mini">
                    <div className="tl-bars">
                      <GhostBar ghost={{ variant: "cur", left: 0, width: 50 }} />
                      <GhostBar ghost={{ variant: "next", left: 50, width: 50 }} />
                    </div>
                  </div>
                  <p className="tl-mcap">
                    <Sk kind="text" width={220} />
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="tl-legend" aria-hidden="true">
        <span>
          <i className="tl-lg tl-lg-cur" />
          Current Window
        </span>
        <span>
          <i className="tl-lg tl-lg-passed" />
          Time Passed
        </span>
        <span>
          <i className="tl-lg tl-lg-next" />
          Next Window
        </span>
        <span>
          <i className="tl-lg tl-lg-prev" />
          Earlier
        </span>
        <span>
          <i className="tl-lg tl-lg-bank" />
          Banked Reset Expires
        </span>
        <span className="tl-tones">
          <i className="tl-dot" data-tone="good" />
          Plenty Left
          <i className="tl-dot" data-tone="warn" />
          Running Low
          <i className="tl-dot" data-tone="bad" />
          Almost Out
        </span>
      </section>

      <div className="tl-pair" aria-hidden="true">
        <section className="tl-card">
          <h2>Up Next</h2>
          <div className="tl-card-body">
            <h3 className="tl-sub">
              <Sk kind="text" width={96} />
            </h3>
            <ItemsGhost count={3} />
          </div>
        </section>
        <section className="tl-card">
          <h2>Watch List</h2>
          <div className="tl-card-body">
            <h3 className="tl-sub">Running Low Until</h3>
            <ItemsGhost count={2} />
          </div>
        </section>
      </div>
    </div>
  );
}
