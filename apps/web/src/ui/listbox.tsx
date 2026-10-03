/* oxlint-disable jsx-a11y/prefer-tag-over-role -- a native <select> cannot hold icons, groups or a blurrable detail */
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { CheckIcon } from "../icons.tsx";
import { cx } from "./cx.ts";
import { useFloatingLayer } from "./floating.ts";
import { extendQuery, groupItems, typeaheadMatch, typeaheadWindow } from "./listbox-model.ts";
import "./fields.css";

/** One row of a listbox. */
export interface ListboxItem {
  readonly value: string;
  readonly label: string;
  readonly meta?: string;
  readonly detail?: string;
  readonly icon?: ReactNode;
  readonly group?: string;
}

/** Rows in the order they show: ungrouped first, then each group in the order its heading first appeared. */
export function orderItems<T extends ListboxItem>(items: readonly T[]): T[] {
  return groupItems(items).flatMap((section) => section.items);
}

/** The space above the first row, so scrolling to the top also reveals the first heading. */
const listPadding = 6;

/**
 * State for a listbox that opens from a trigger: the floating layer, the active row, and the keys that drive it
 * (arrows, Home, End, Page keys, typeahead, Enter and Space, Escape). `items` must already be in display order.
 * Focus sits on the panel while it is open and the active row is announced with aria-activedescendant.
 */
export function useListbox(config: {
  readonly items: readonly ListboxItem[];
  readonly value: string | null;
  readonly onPick: (value: string) => void;
  readonly gap: number;
  readonly align: "start" | "end";
  readonly matchWidth: boolean;
}) {
  const { items, value, onPick, gap, align, matchWidth } = config;
  const { layer, triggerRef, panelRef } = useFloatingLayer(gap, false, { align, matchWidth });
  const baseId = useId();
  const [active, setActive] = useState(-1);
  const query = useRef({ text: "", at: 0 });
  const { open } = layer;
  const selected = items.findIndex((item) => item.value === value);

  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open, panelRef]);

  // Keep the active row inside the scrolling panel without scrolling the page or the dialog around it.
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || panel === null) return;
    const row = panel.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (row === null) return;
    if (active === 0) panel.scrollTop = 0;
    else if (row.offsetTop - listPadding < panel.scrollTop)
      panel.scrollTop = row.offsetTop - listPadding;
    else if (
      row.offsetTop + row.offsetHeight + listPadding >
      panel.scrollTop + panel.clientHeight
    ) {
      panel.scrollTop = row.offsetTop + row.offsetHeight + listPadding - panel.clientHeight;
    }
  }, [open, active, panelRef]);

  const show = (): void => {
    setActive(selected >= 0 ? selected : 0);
    layer.show();
  };
  const pick = (index: number): void => {
    const item = items[index];
    if (item === undefined) return;
    onPick(item.value);
    layer.hide();
  };

  const optionId = (index: number): string => `${baseId}-${index}`;

  const onPanelKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const last = items.length - 1;
    const move = (to: number): void => {
      event.preventDefault();
      setActive(Math.max(0, Math.min(last, to)));
    };
    switch (event.key) {
      case "ArrowDown":
        return move(active + 1);
      case "ArrowUp":
        return move(active - 1);
      case "Home":
        return move(0);
      case "End":
        return move(last);
      case "PageDown":
        return move(active + 8);
      case "PageUp":
        return move(active - 8);
      case "Escape":
        // Keep the Escape for this list: a surrounding dialog must stay open.
        event.preventDefault();
        event.stopPropagation();
        return layer.hide();
      case "Tab":
        // Let the browser move focus on from here; close without pulling it back to the trigger.
        return layer.hide(false);
      case "Enter":
        event.preventDefault();
        return pick(active);
      default:
    }
    const typing = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!typing) return;
    const now = Date.now();
    const midQuery = query.current.text !== "" && now - query.current.at <= typeaheadWindow;
    if (event.key === " " && !midQuery) {
      event.preventDefault();
      pick(active);
      return;
    }
    event.preventDefault();
    const text = extendQuery(query.current, event.key, now);
    query.current = { text, at: now };
    const hit = typeaheadMatch(
      items.map((item) => item.label),
      text,
      active,
    );
    if (hit >= 0) setActive(hit);
  };

  // The refs travel beside the state, not inside it, so rendering from the state never reads a ref.
  const box = {
    layer,
    items,
    selected,
    active,
    setActive,
    optionId,
    pick,
    onPanelKeyDown,
    align,
    triggerProps: {
      "aria-haspopup": "listbox" as const,
      "aria-expanded": open,
      "aria-controls": layer.panelId,
      onClick: () => (open ? layer.hide() : show()),
      onKeyDown: (event: KeyboardEvent<HTMLElement>): void => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          layer.hide();
          return;
        }
        if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
        event.preventDefault();
        show();
      },
    },
  };
  return { box, triggerRef, panelRef };
}

/** The floating list itself. Render it next to the trigger; it lives in the top layer, so a dialog never clips it. */
export function ListboxPanel(props: {
  readonly box: ReturnType<typeof useListbox>["box"];
  readonly panelRef: RefObject<HTMLDivElement | null>;
  /** Accessible name of the list. */
  readonly label: string;
  readonly className?: string;
}) {
  const { box, panelRef, label, className } = props;
  const { layer, items } = box;
  const sections = groupItems(items);
  const headingBase = useId();
  const row = (item: ListboxItem) => {
    const index = items.indexOf(item);
    const chosen = index === box.selected;
    return (
      // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- the listbox owns the keyboard and names the active row with aria-activedescendant
      <div
        key={item.value}
        id={box.optionId(index)}
        role="option"
        aria-selected={chosen}
        data-index={index}
        data-active={index === box.active ? "" : undefined}
        className="lb-opt"
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" && box.active !== index) box.setActive(index);
        }}
        onClick={() => box.pick(index)}
      >
        {item.icon === undefined ? null : <span className="lb-icon">{item.icon}</span>}
        <span className="lb-text">
          <span className="lb-line">
            <span className="lb-label">{item.label}</span>
            {item.meta === undefined ? null : <span className="lb-meta">{item.meta}</span>}
          </span>
          {item.detail === undefined ? null : <span className="who lb-detail">{item.detail}</span>}
        </span>
        <span className="lb-check" aria-hidden="true">
          {chosen ? <CheckIcon /> : null}
        </span>
      </div>
    );
  };
  return (
    <div
      ref={panelRef}
      id={layer.panelId}
      className={cx(
        "notif fpop",
        box.align === "start" && "fpop-start",
        layer.above && "above",
        className,
      )}
      role="listbox"
      aria-label={label}
      aria-activedescendant={box.active >= 0 ? box.optionId(box.active) : undefined}
      popover="manual"
      tabIndex={-1}
      style={layer.style}
      onKeyDown={box.onPanelKeyDown}
    >
      {sections.map((section, at) =>
        section.heading === null ? (
          <Fragment key="loose">{section.items.map(row)}</Fragment>
        ) : (
          <div key={section.heading} role="group" aria-labelledby={`${headingBase}-${at}`}>
            <div id={`${headingBase}-${at}`} className="lb-group">
              {section.heading}
            </div>
            {section.items.map(row)}
          </div>
        ),
      )}
    </div>
  );
}
