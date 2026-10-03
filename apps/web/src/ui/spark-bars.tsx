import { useId, useRef, useState } from "react";

import { cssVars } from "./css-vars.ts";
import { useInView } from "./use-in-view.ts";
import "./spark-bars.css";

/** One bar of `SparkBars`. */
export interface SparkBar {
  readonly key: string;
  /** Short axis label, for example "Oct". */
  readonly label: string;
  readonly value: number;
  /** The value as read out and shown on hover, for example "$30". */
  readonly display: string;
  /** The bar to emphasise, such as the current month. */
  readonly active?: boolean;
}

const defaultHeight = 56;

/**
 * A compact bar chart for a stat (Arc bar-chart look): one bar per period, the active one in the full accent and
 * the rest muted, labels under the bars, the value on hover or focus. Zero bars keep a hairline stub.
 *
 * Keyboard and assistive tech: the plot is one tab stop (a range input over the bars). The arrow keys, Home and End
 * move between bars and show the bar's label and value above the plot; Escape hides them. A hidden line lists every
 * bar for screen readers.
 */
export function SparkBars(props: {
  readonly label: string;
  readonly bars: readonly SparkBar[];
  /** Plot height in pixels. */
  readonly height?: number;
}) {
  const { label, bars, height = defaultHeight } = props;
  const figure = useRef<HTMLElement>(null);
  const seen = useInView(figure);
  const summaryId = useId();
  const initial = Math.max(
    0,
    bars.findIndex((bar) => bar.active === true),
  );
  const [cursor, setCursor] = useState<number | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const last = bars.length - 1;
  const at = Math.min(cursor ?? (bars.some((bar) => bar.active === true) ? initial : last), last);
  const lit = hot === null ? null : Math.min(hot, last);
  const readout = lit === null ? undefined : bars[lit];
  const max = bars.reduce((most, bar) => Math.max(most, bar.value), 0);
  const stagger = Math.min(35, 320 / Math.max(1, bars.length));
  const focused = bars[at];

  const point = (index: number): void => {
    setHot(index);
    setCursor(index);
  };

  return (
    <figure
      ref={figure}
      className="spark"
      data-grown={seen || undefined}
      data-scrub={lit !== null || undefined}
      style={cssVars({ "--plot": `${height}px` })}
    >
      <div className="spark-readout" aria-hidden="true">
        {readout === undefined ? null : (
          <>
            <span className="spark-readout-label">{readout.label}</span>
            <span className="spark-readout-value">{readout.display}</span>
          </>
        )}
      </div>
      <div className="spark-plot" onPointerLeave={() => setHot(null)}>
        {/* One range input stands for the bars: a single tab stop, and the arrow keys, Home and End move along them. */}
        <input
          className="spark-input"
          type="range"
          min={0}
          max={Math.max(0, last)}
          step={1}
          value={Math.max(0, at)}
          aria-label={label}
          aria-describedby={summaryId}
          aria-valuetext={
            focused === undefined ? "No data" : `${focused.label}, ${focused.display}`
          }
          onChange={(event) => point(Number(event.currentTarget.value))}
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible")) setHot(at);
          }}
          onBlur={() => setHot(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setHot(null);
          }}
        />
        {bars.map((bar, index) => {
          const share = max > 0 ? Math.max(0, bar.value) / max : 0;
          return (
            <span
              key={bar.key}
              className="spark-slot"
              data-lit={index === lit || (lit === null && bar.active === true) || undefined}
              data-zero={bar.value <= 0 || undefined}
              style={cssVars({ "--share": share, "--delay": `${index * stagger}ms` })}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") point(index);
              }}
              onPointerDown={() => point(index)}
            >
              <span className="spark-well">
                <span className="spark-bar" />
              </span>
              <span className="spark-tick" aria-hidden="true">
                {bar.label}
              </span>
            </span>
          );
        })}
      </div>
      <p className="sr" id={summaryId}>
        {`${label}. ${bars.map((bar) => `${bar.label} ${bar.display}`).join(", ")}.`}
      </p>
    </figure>
  );
}
