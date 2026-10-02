import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cx } from "./cx.ts";
import "./tabs.css";

/** One tab: the value it selects and what it shows. */
export interface TabItem<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
}

/**
 * Tabs that choose one value. Left and Right move between them and select as they go; Home and End jump to the
 * ends. Put the content in an element with `role="tabpanel"` and pass its id as `panelId`. With `indicator`, a
 * line under the chosen tab slides to the next one. `className` and `tabClassName` carry the look.
 */
export function Tabs<T extends string>(props: {
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly tabs: readonly TabItem<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly panelId: string;
  readonly className?: string;
  readonly tabClassName?: string;
  readonly indicator?: boolean;
}) {
  const { tabs, value, onChange, indicator = false } = props;
  const list = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const at = tabs.findIndex((tab) => tab.value === value);

  // The line follows the chosen tab. A closed dialog has no size, so it waits and then lands in place.
  useLayoutEffect(() => {
    const listEl = list.current;
    const markEl = mark.current;
    if (!indicator || listEl === null || markEl === null) return;
    const place = (): void => {
      const chosen = listEl.querySelectorAll<HTMLElement>('[role="tab"]')[at];
      if (chosen === undefined || chosen.offsetWidth === 0) {
        markEl.removeAttribute("data-on");
        return;
      }
      const arriving = !markEl.hasAttribute("data-on");
      if (arriving) markEl.setAttribute("data-snap", "");
      markEl.style.setProperty("--tab-x", `${chosen.offsetLeft}px`);
      markEl.style.setProperty("--tab-w", `${chosen.offsetWidth}px`);
      if (arriving) {
        markEl.getBoundingClientRect();
        markEl.removeAttribute("data-snap");
      }
      markEl.setAttribute("data-on", "true");
    };
    place();
    const watcher = new ResizeObserver(place);
    watcher.observe(listEl);
    return () => watcher.disconnect();
  }, [at, indicator]);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : null;
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : step === null
            ? null
            : (at + step + tabs.length) % tabs.length;
    const next = target === null ? undefined : tabs[target];
    if (next === undefined) return;
    event.preventDefault();
    onChange(next.value);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[target ?? 0]?.focus();
  };

  return (
    <div
      ref={list}
      className={cx("tabs", props.className)}
      role="tablist"
      aria-label={props.label}
      tabIndex={-1}
      onKeyDown={move}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={props.panelId}
            tabIndex={selected ? 0 : -1}
            className={props.tabClassName}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
      {indicator ? <span ref={mark} className="tabs-mark" aria-hidden="true" /> : null}
    </div>
  );
}
