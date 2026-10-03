/* oxlint-disable jsx-a11y/prefer-tag-over-role -- an ARIA grid on divs: a native table cannot slide and fade a month without losing its layout */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { CalendarIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "../icons.tsx";
import {
  addDays,
  addMonths,
  clampDate,
  endOfWeek,
  formatFull,
  formatMonth,
  formatShort,
  isOutOfRange,
  monthGrid,
  sameMonth,
  startOfMonth,
  startOfWeek,
  todayIso,
  weekdayLabels,
  type IsoDate,
} from "./calendar.ts";
import { cx } from "./cx.ts";
import { useFloatingLayer } from "./floating.ts";
import { prefersReducedMotion } from "./motion.ts";
import "./fields.css";

/** Arc closes the calendar about this long after a pick, so the highlight lands first. */
const closeBeat = 240;

/**
 * Arc's date picker, built natively: a field-styled trigger showing the date in words ("Oct 12, 2026") that opens
 * a month calendar popover. Values are `YYYY-MM-DD` strings. `optional` adds a Clear action.
 */
export function DatePicker(props: {
  readonly label: string;
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly optional?: boolean;
  readonly min?: string;
  readonly max?: string;
  readonly error?: string | null;
}) {
  const id = useId();
  const { value, onChange, min, max } = props;
  const { layer, triggerRef, panelRef } = useFloatingLayer(6, false, { align: "start" });
  const { open } = layer;
  const [view, setView] = useState<IsoDate>(() => startOfMonth(value ?? todayIso()));
  const [focus, setFocus] = useState<IsoDate>(() => value ?? todayIso());
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  const wantFocus = useRef(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const today = todayIso();

  useEffect(() => {
    if (!open) window.clearTimeout(closeTimer.current);
  }, [open]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  // Move focus onto the day that owns the tab stop, after the calendar opens or the focused day changes month.
  useEffect(() => {
    if (!open || !wantFocus.current) return;
    const button = panelRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`);
    if (button === null || button === undefined) return;
    wantFocus.current = false;
    button.focus({ preventScroll: true });
  }, [open, focus, panelRef]);

  const show = (): void => {
    const base = clampDate(value ?? today, min, max);
    setView(startOfMonth(base));
    setFocus(base);
    setDirection(null);
    wantFocus.current = true;
    layer.show();
  };

  const goToMonth = (next: IsoDate): void => {
    setDirection(next > view ? "next" : "prev");
    setView(startOfMonth(next));
  };

  const pick = (iso: IsoDate): void => {
    if (isOutOfRange(iso, min, max)) return;
    onChange(iso);
    setFocus(iso);
    window.clearTimeout(closeTimer.current);
    if (prefersReducedMotion()) layer.hide();
    else closeTimer.current = window.setTimeout(() => layer.hide(), closeBeat);
  };

  const moveFocus = (target: IsoDate): void => {
    const next = clampDate(target, min, max);
    if (next === focus) return;
    setFocus(next);
    wantFocus.current = true;
    if (!sameMonth(next, view)) goToMonth(next);
  };

  const onDayKey = (event: KeyboardEvent<HTMLButtonElement>, iso: IsoDate): void => {
    const targets: Record<string, IsoDate> = {
      ArrowLeft: addDays(iso, -1),
      ArrowRight: addDays(iso, 1),
      ArrowUp: addDays(iso, -7),
      ArrowDown: addDays(iso, 7),
      Home: startOfWeek(iso),
      End: endOfWeek(iso),
      PageUp: addMonths(iso, event.shiftKey ? -12 : -1),
      PageDown: addMonths(iso, event.shiftKey ? 12 : 1),
    };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    moveFocus(target);
  };

  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Tab") {
      layer.hide(false);
      return;
    }
    if (event.key !== "Escape") return;
    // Keep the Escape for the calendar: a surrounding dialog must stay open.
    event.preventDefault();
    event.stopPropagation();
    layer.hide();
  };

  const previous = addMonths(view, -1);
  const next = addMonths(view, 1);
  const previousBlocked = min !== undefined && startOfMonth(previous) < startOfMonth(min);
  const nextBlocked = max !== undefined && next > max;
  // The roving tab stop: the focused day if it is on show, else the first day of the month that can be reached.
  const tabStop = sameMonth(focus, view) ? focus : clampDate(view, min, max);
  const weeks = monthGrid(view);
  const weekdays = weekdayLabels();
  const error = props.error ?? null;

  return (
    <div className="field fld">
      <label id={`${id}-label`} htmlFor={`${id}-trigger`}>
        {props.label}
      </label>
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        className="fld-trigger"
        data-invalid={error === null ? undefined : ""}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={layer.panelId}
        aria-describedby={error === null ? undefined : `${id}-note`}
        onClick={() => (open ? layer.hide() : show())}
        onKeyDown={(event) => {
          if (open && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            layer.hide();
          } else if (!open && event.key === "ArrowDown") {
            event.preventDefault();
            show();
          }
        }}
      >
        <span className="fld-lead">
          <CalendarIcon />
        </span>
        <span id={`${id}-value`} className="fld-value">
          {value === null ? (
            <span className="fld-ph">Pick a date</span>
          ) : (
            <span className="fld-main">{formatShort(value)}</span>
          )}
        </span>
        <span className="fld-chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape and Tab apply to the whole calendar, not one control */}
      <div
        ref={panelRef}
        id={layer.panelId}
        className={cx("notif fpop fpop-start fpop-cal", layer.above && "above")}
        role="dialog"
        aria-label={`${props.label} calendar`}
        popover="manual"
        tabIndex={-1}
        style={layer.style}
        onKeyDown={onPanelKey}
      >
        <div className="cal-head">
          <h2 className="cal-title" aria-live="polite">
            <span key={view} data-dir={direction ?? undefined}>
              {formatMonth(view)}
            </span>
          </h2>
          <div className="cal-nav">
            <button
              type="button"
              className="cal-step"
              aria-label="Previous month"
              aria-disabled={previousBlocked ? true : undefined}
              onClick={() => {
                if (!previousBlocked) goToMonth(previous);
              }}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className="cal-step"
              aria-label="Next month"
              aria-disabled={nextBlocked ? true : undefined}
              onClick={() => {
                if (!nextBlocked) goToMonth(next);
              }}
            >
              <ChevronRightIcon />
            </button>
          </div>
        </div>
        <div className="cal-grid" role="grid" aria-label={formatMonth(view)}>
          <div className="cal-row" role="row">
            {weekdays.map((name) => (
              <div key={name} className="cal-wd" role="columnheader" aria-label={name}>
                {name.slice(0, 2)}
              </div>
            ))}
          </div>
          <div key={view} className="cal-body" role="rowgroup" data-dir={direction ?? undefined}>
            {weeks.map((week) => (
              <div key={week[0]} className="cal-row" role="row">
                {week.map((iso) => {
                  const selected = iso === value;
                  return (
                    <div key={iso} className="cal-cell" role="gridcell" aria-selected={selected}>
                      <button
                        type="button"
                        className="cal-day"
                        data-iso={iso}
                        data-selected={selected ? "" : undefined}
                        data-today={iso === today ? "" : undefined}
                        data-outside={sameMonth(iso, view) ? undefined : ""}
                        aria-label={formatFull(iso)}
                        aria-current={iso === today ? "date" : undefined}
                        tabIndex={iso === tabStop ? 0 : -1}
                        disabled={isOutOfRange(iso, min, max)}
                        onFocus={() => setFocus(iso)}
                        onKeyDown={(event) => onDayKey(event, iso)}
                        onClick={() => pick(iso)}
                      >
                        {Number(iso.slice(8))}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {props.optional === true ? (
          <div className="cal-foot">
            <button
              type="button"
              className="cal-clear"
              disabled={value === null}
              onClick={() => {
                onChange(null);
                layer.hide();
              }}
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>
      {error === null ? null : (
        <p id={`${id}-note`} className="dl-note bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
