import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cssVars } from "./css-vars.ts";
import { labelsToShow, monthDayText, placeMarks, stackShift, ticksFor } from "./day-strip-model.ts";
import { useInView } from "./use-in-view.ts";
import "./day-strip.css";

/** One mark on a `DayStrip`. */
export interface DayMark {
  readonly key: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** Read out and shown on hover or focus, for example "Claude Pro · $21.01". */
  readonly label: string;
  readonly icon?: ReactNode;
  /** The mark to emphasise, such as the next renewal. */
  readonly emphasis?: boolean;
}

/** A dot is a zero-length stroke with round caps, like the end dot of Arc's sparkline. */
function Dot(props: { readonly emphasis: boolean }) {
  return (
    <svg className="day-dot" viewBox="-8 -8 16 16" aria-hidden="true" focusable="false">
      {props.emphasis ? <circle className="day-ring" r="7" /> : null}
      <path className="day-core" d="M0 0h0" strokeWidth={props.emphasis ? 10 : 8} />
    </svg>
  );
}

/**
 * A compact strip of the coming days with a mark on each date that has something on it, for example renewals
 * over the next 30 days. Today sits at the left edge; a few day ticks label the scale. Marks outside the strip
 * are left out; marks on one day stack side by side.
 *
 * Keyboard: the strip is one tab stop. Left and right arrows (and Home and End) move between marks in date order;
 * the focused mark shows its label. Each mark is a button named by its label and date.
 */
export function DayStrip(props: {
  readonly label: string;
  /** First day, `YYYY-MM-DD`. */
  readonly start: string;
  readonly days: number;
  readonly marks: readonly DayMark[];
}) {
  const { label, start, days, marks } = props;
  const root = useRef<HTMLFieldSetElement>(null);
  const seen = useInView(root, 0.5);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [rover, setRover] = useState(0);
  const ticks = ticksFor(start, days);
  const placed = placeMarks(start, days, marks);
  const stop = Math.min(rover, Math.max(0, placed.length - 1));
  const lastTick = ticks.length - 1;
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  // Offsets of the ticks that keep a label; null until measured, which shows all of them.
  const [shown, setShown] = useState<ReadonlySet<number> | null>(null);
  const step = Math.min(35, 280 / Math.max(1, placed.length));

  // Labels never overlap: when the strip is too narrow for all of them, the middle ones drop and their ticks stay.
  useEffect(() => {
    const node = root.current;
    if (node === null) return;
    const measure = (): void => {
      const widths = labels.current.map((tickLabel) => tickLabel?.offsetWidth ?? 0);
      const next = labelsToShow(ticksFor(start, days), widths, {
        width: node.clientWidth,
        edge: 10,
      });
      setShown((was) =>
        was !== null && was.size === next.size && [...next].every((offset) => was.has(offset))
          ? was
          : next,
      );
    };
    // The observer reports once when it starts, which does the first measurement.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [start, days]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, here: number): void => {
    const last = placed.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: here + 1,
      ArrowDown: here + 1,
      ArrowLeft: here - 1,
      ArrowUp: here - 1,
      Home: 0,
      End: last,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    buttons.current[Math.min(last, Math.max(0, target))]?.focus();
  };

  return (
    <fieldset ref={root} className="day-strip" aria-label={label} data-seen={seen || undefined}>
      <div className="day-track">
        <span className="day-baseline" aria-hidden="true" />
        {ticks.map((tick, index) => (
          <span
            key={tick.offset}
            className="day-tick"
            aria-hidden="true"
            data-edge={index === 0 ? "start" : index === lastTick ? "end" : undefined}
            data-label={shown === null || shown.has(tick.offset) ? undefined : "hidden"}
            style={cssVars({ "--at": tick.fraction })}
          >
            <span
              className="day-tick-label"
              ref={(node) => {
                labels.current[index] = node;
              }}
            >
              {tick.label}
            </span>
          </span>
        ))}
        {placed.map((mark, order) => {
          const source = marks[mark.index];
          if (source === undefined) return null;
          return (
            <button
              key={mark.key}
              ref={(node) => {
                buttons.current[order] = node;
              }}
              type="button"
              className="day-mark"
              tabIndex={order === stop ? 0 : -1}
              aria-label={`${source.label}, ${monthDayText(source.date)}`}
              data-emphasis={source.emphasis === true || undefined}
              data-edge={mark.fraction < 0.2 ? "start" : mark.fraction > 0.8 ? "end" : undefined}
              onFocus={() => setRover(order)}
              onKeyDown={(event) => onKeyDown(event, order)}
              style={cssVars({
                "--at": mark.fraction,
                "--shift": `${stackShift(mark.stack, mark.stackOf)}px`,
                "--delay": `${order * step}ms`,
              })}
            >
              {source.icon === undefined ? null : (
                <span className="day-icon" aria-hidden="true">
                  {source.icon}
                </span>
              )}
              <Dot emphasis={source.emphasis === true} />
              <span className="day-tip" aria-hidden="true">
                <span>{source.label}</span>
                <span className="day-tip-date">{monthDayText(source.date)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
