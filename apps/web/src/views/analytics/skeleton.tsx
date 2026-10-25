import type { ReactNode } from "react";

import { ChevronDownIcon } from "../../icons.tsx";
import { LoadingNote, Sk } from "../../ui/skeleton.tsx";
// The skeleton is the Suspense fallback while this view's code loads, so its styles ship with the first screen.
import "./analytics.css";
import "./common.css";
import { Head as PageHead, TabFace } from "./head.tsx";
import { reports, storedReport, type Report } from "./reports.ts";
import "./skeleton.css";

const count = (length: number): number[] => Array.from({ length }, (_, index) => index);

/** The view switch as the page shows it, with the first view pressed. It is not interactive. */
function Switch(props: { readonly labels: readonly string[] }) {
  return (
    <fieldset className="seg" inert>
      {props.labels.map((label, index) => (
        <button key={label} type="button" tabIndex={-1} aria-pressed={index === 0}>
          {label}
        </button>
      ))}
    </fieldset>
  );
}

/** The account filter's closed dropdown, with its real label. */
function Filter() {
  return (
    <div className="an2-filter">
      <div className="field fld" data-size="sm" inert>
        <button type="button" className="fld-trigger" data-size="sm" tabIndex={-1}>
          <span className="fld-value">
            <span className="fld-main">All Accounts</span>
          </span>
          <span className="fld-chevron" aria-hidden="true">
            <ChevronDownIcon />
          </span>
        </button>
      </div>
    </div>
  );
}

/** A card's first row: the headline in two lines, then the view switch. */
function Top(props: {
  readonly big: number;
  readonly cap: number;
  readonly labels: readonly string[];
}) {
  return (
    <div className="an2-top">
      <div className="an2-ro">
        <p className="an2-ro-big">
          <Sk kind="text" width={props.big} />
        </p>
        <p className="an2-ro-cap">
          <Sk kind="text" width={props.cap} />
        </p>
      </div>
      <div className="an2-tools">
        <Switch labels={props.labels} />
      </div>
    </div>
  );
}

function Swatch(props: { readonly kind: string; readonly level?: number | undefined }) {
  return <i className="an2-sw" data-kind={props.kind} data-level={props.level} />;
}

/** A legend item with a real label. */
function Item(props: { readonly kind: string; readonly children: string }) {
  return (
    <span>
      <Swatch kind={props.kind} />
      {props.children}
    </span>
  );
}

/** A legend item whose words depend on the data. */
function LegendSk(props: {
  readonly kind: string;
  readonly width: number;
  readonly level?: number | undefined;
}) {
  return (
    <span>
      <Swatch kind={props.kind} level={props.level} />
      <span>
        <Sk kind="text" width={props.width} />
      </span>
    </span>
  );
}

function Round(props: { readonly size: number }) {
  return <Sk width={props.size} height={props.size} className="ans-round" />;
}

/* ------------------------------------------------------------ rhythm */

const weekRows = count(24);
const dayColumns = count(31);
const hourLabels = [0, 6, 12, 18] as const;

function RhythmBody() {
  return (
    <div className="rh-view ans-view">
      <Top big={300} cap={360} labels={["Matrix", "Weeks", "Range", "By Account"]} />
      <div className="ans-mx">
        <div className="ans-mx-body">
          <div className="ans-mx-dates">
            <div className="ans-mx-months">
              {[0, 7, 14, 21, 28].map((day) => (
                <span key={day} style={{ left: `${(day / 31) * 100}%` }}>
                  <Sk kind="text" width={34} />
                </span>
              ))}
            </div>
            <Sk kind="line" className="ans-mx-days" />
          </div>
          <div className="ans-mx-hours">
            {hourLabels.map((hour) => (
              <span key={hour} style={{ top: `calc(${hour} * var(--rh))` }}>
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <div className="ans-mx-cells">
            {dayColumns.map((day) =>
              weekRows.map((hour) => <i key={`${day}.${hour}`} className="ans-cell" />),
            )}
          </div>
          <span className="ans-mx-locked">Locked</span>
          <div className="ans-mx-strip">
            {dayColumns.map((day) => (
              <i key={day} className="ans-cell ans-cell-strip" />
            ))}
          </div>
          <div className="ans-mx-profile">
            <span className="ans-t2">Day profile</span>
            <span className="ans-t">avg accounts active</span>
            <div className="ans-mx-line">
              <Sk kind="block" />
            </div>
          </div>
        </div>
      </div>
      <div className="an2-legend">
        <span>Accounts active</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <LegendSk key={level} kind="ramp" level={level} width={24} />
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
      </div>
      <section className="ans-windows">
        <div className="ans-disclose">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4 2.5 7.5 6 4 9.5" />
          </svg>
          <span className="ans-disclose-title">Usage per window</span>
          <span className="ans-disclose-hint">How full each limit window got</span>
        </div>
      </section>
    </div>
  );
}

/* --------------------------------------------------------- right now */

const forecastRows = count(9);
const forecastCells = count(28);
const dayMarks = [0, 3, 7, 11, 15, 19, 23] as const;

function ForecastBody() {
  return (
    <div className="an2-split ans-split ans-now">
      <div className="ans-fc">
        <div className="ans-grid">
          <div className="ans-line ans-axis">
            <span />
            <span className="ans-axis-days">
              <span className="ans-now-label" style={{ left: "2%" }}>
                Now
              </span>
              {dayMarks.map((mark) => (
                <span key={mark} className="ans-axis-day" style={{ left: `${(mark / 28) * 100}%` }}>
                  <Sk kind="text" width={22} />
                </span>
              ))}
            </span>
            <span />
          </div>
          <div className="ans-body">
            {forecastRows.map((row) => (
              <div key={row} className="ans-row ans-line">
                <span className="ans-who">
                  <Round size={16} />
                  <Sk kind="text" width={110} />
                </span>
                <span className="ans-cells">
                  {forecastCells.map((cell) => (
                    <i key={cell} className="ans-cell ans-cell-fc" />
                  ))}
                </span>
                <span className="ans-gutter">
                  <span className="ans-gutter-a">
                    <Sk kind="text" width={104} />
                  </span>
                  <span className="ans-gutter-b">
                    <Sk kind="text" width={88} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="an2-legend">
          <span>
            Projected use
            <i className="ans-sw-cell" data-level="0" />
            <i className="ans-sw-cell" data-level="1" />
            <i className="ans-sw-cell" data-level="2" />
            <i className="ans-sw-cell" data-level="3" />
            under 25, 50, 75, 100%
          </span>
          <Item kind="band">Runs out</Item>
          <Item kind="band">Locked until reset</Item>
          <Item kind="line">Reset</Item>
          <Item kind="dash">New window, no forecast</Item>
          <span>Assumes the pace holds. Select a row for detail.</span>
        </div>
      </div>
      <aside className="an2-panel">
        <div className="ans-head">
          <span className="ans-who ans-who-strong">
            <Round size={20} />
            <span className="ans-who-text">
              <span className="ans-nm">
                <Sk kind="text" width={120} />
              </span>
              <span className="ans-sb">
                <Sk kind="text" width={150} />
              </span>
            </span>
          </span>
          <p className="ans-sub">
            <Sk kind="text" width={190} />
          </p>
        </div>
        <div className="ans-burn">
          <Sk kind="block" height={176} />
          <div className="an2-legend">
            <LegendSk kind="line" width={30} />
            <LegendSk kind="dash" width={70} />
            <LegendSk kind="dash" width={56} />
            <LegendSk kind="dot" width={60} />
          </div>
        </div>
        <dl className="ans-facts">
          {["Pace", "Runs out", "Locked before reset"].map((name) => (
            <div key={name}>
              <dt>
                <Sk kind="text" width={name.length > 10 ? 80 : 44} />
              </dt>
              <dd>
                <Sk kind="text" width={72} />
              </dd>
            </div>
          ))}
        </dl>
        <div className="ans-recent">
          <p className="ans-sec">
            <b>Recent pace</b> · pp used per day
          </p>
          <p className="ans-sub">
            <Sk kind="text" width={120} />
          </p>
          <Sk kind="block" height={104} />
          <div className="an2-legend">
            <Item kind="ramp">Within allowance</Item>
            <Item kind="dot">Over</Item>
            <Item kind="dash">Allowed per day</Item>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------- plan fit */

const fitRows = count(9);
const fitCells = count(13);
const peaks = [
  { id: "w0", peak: 88 },
  { id: "w1", peak: 92 },
  { id: "w2", peak: 60 },
  { id: "w3", peak: 95 },
  { id: "w4", peak: 70 },
  { id: "w5", peak: 40 },
  { id: "w6", peak: 84 },
  { id: "w7", peak: 96 },
  { id: "w8", peak: 66 },
  { id: "w9", peak: 52 },
  { id: "w10", peak: 90 },
  { id: "w11", peak: 74 },
  { id: "w12", peak: 80 },
  { id: "w13", peak: 46 },
] as const;

function Tile(props: { readonly label: string; readonly small: number }) {
  return (
    <div className="ans-tile">
      <span className="ans-tile-l">{props.label}</span>
      <span className="ans-tile-v">
        <Sk kind="text" width={56} />
        {props.small > 0 ? (
          <small>
            <Sk kind="text" width={props.small} />
          </small>
        ) : null}
      </span>
    </div>
  );
}

function FitBody() {
  return (
    <div className="ans-fit ans-view">
      <Top big={300} cap={360} labels={["History", "Actions"]} />
      <div className="an2-split ans-split ans-fitsplit">
        <div className="ans-main">
          <div className="ans-fitgrid">
            <div className="ans-frow ans-fhead">
              <span />
              <div className="ans-fplot">
                {[8, 46, 78].map((left) => (
                  <span key={left} style={{ left: `${left}%` }}>
                    <Sk kind="text" width={24} />
                  </span>
                ))}
              </div>
              <span />
            </div>
            {fitRows.map((row) => (
              <div key={row} className="ans-frow">
                <span className="ans-who">
                  <Round size={16} />
                  <Sk kind="text" width={96} />
                </span>
                <div className="ans-fplot">
                  <span className="ans-fcells">
                    {fitCells.map((cell) => (
                      <i key={cell} className="ans-cell ans-cell-fit" />
                    ))}
                  </span>
                </div>
                <span className="ans-verdict">
                  <Sk kind="text" width={72} />
                </span>
              </div>
            ))}
          </div>
          <div className="an2-legend">
            <span>
              {[0, 1, 2, 3].map((level) => (
                <Swatch key={level} kind="ramp" level={level} />
              ))}
              Peak: under 40, 40-60, 60-80, 80-99%
            </span>
            <Item kind="band">Hit the limit</Item>
            <Item kind="dash">Current window</Item>
            <span>One cell per window. Width is its length.</span>
          </div>
        </div>
        <aside className="an2-panel ans-fitpanel">
          <div className="ans-fhead2">
            <Round size={24} />
            <div className="ans-id">
              <span className="ans-nm">
                <Sk kind="text" width={110} />
              </span>
              <span className="ans-sb">
                <Sk kind="text" width={80} />
              </span>
            </div>
            <span className="ans-verdict">
              <Sk kind="text" width={72} />
            </span>
          </div>
          <div className="ans-tiles">
            <Tile label="Average peak" small={0} />
            <Tile label="At the limit" small={60} />
            <Tile label="Locked" small={64} />
            <Tile label="Unused" small={90} />
          </div>
          <p className="ans-fsec">
            <b>Peak per week</b> · last 90 days
          </p>
          <div className="ans-cols">
            <div className="ans-cols-plot">
              {peaks.map(({ id, peak }) => (
                <span key={id} className="ans-col-slot">
                  <Sk kind="block" className="ans-col" height={`${peak}%`} />
                </span>
              ))}
            </div>
            <span className="ans-cols-label">
              <span>
                <Sk kind="text" width={30} />
              </span>
              <span>
                <Sk kind="text" width={64} />
              </span>
            </span>
          </div>
          <div className="an2-legend">
            <Item kind="ramp">Peak</Item>
            <Item kind="band">Hit the limit</Item>
            <Item kind="fill">Now</Item>
            <Item kind="dash">Average</Item>
          </div>
          <p className="ans-obs">
            <Sk kind="text" width="100%" />
            <Sk kind="text" width="62%" />
          </p>
        </aside>
      </div>
    </div>
  );
}

function Card(props: { readonly children: ReactNode }) {
  return (
    <section className="an2-card" aria-hidden="true">
      {props.children}
    </section>
  );
}

/** The page header and the report tabs, with their real names and the open tab pressed. */
function Head(props: { readonly open: Report }) {
  return (
    <>
      <PageHead status={<Sk kind="text" width={180} />}>
        <Filter />
      </PageHead>
      <div className="an-tabs" inert>
        {reports.map((entry) => (
          <div key={entry.value} className="an-tab" data-open={entry.value === props.open}>
            <TabFace
              {...entry}
              big={<Sk kind="text" width="80%" />}
              cap={<Sk kind="text" width="92%" />}
            />
          </div>
        ))}
      </div>
    </>
  );
}

/** The page's first-load placeholder: the header, the tabs and the report opened last, with real frames. */
export function AnalyticsSkeleton() {
  const open = storedReport();
  return (
    <div className="an-page ans" aria-busy="true">
      <LoadingNote>Loading analytics</LoadingNote>
      <Head open={open} />
      <Card>
        {open === "rhythm" ? <RhythmBody /> : null}
        {open === "now" ? (
          <>
            <Top big={300} cap={360} labels={["Forecast", "Table"]} />
            <ForecastBody />
          </>
        ) : null}
        {open === "fit" ? <FitBody /> : null}
      </Card>
    </div>
  );
}
