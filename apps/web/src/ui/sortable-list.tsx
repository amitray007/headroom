import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import { GripIcon } from "../icons.tsx";
import { clampShift, offsetsFor, targetIndex, type Slot } from "../lib/reorder.ts";
import { prefersReducedMotion } from "./motion.ts";

export interface SortableItem {
  readonly id: string;
  /** The name read aloud and shown. */
  readonly label: string;
  readonly icon?: ReactNode;
}

/** A mouse press must move this far before the drag starts. */
const slop = 3;
/** The dragged row settles on its slot for about this long before the order commits. */
const settleMs = 200;

interface Drag {
  readonly from: number;
  readonly rows: readonly HTMLElement[];
  readonly slots: readonly Slot[];
  readonly startY: number;
  readonly pointerId: number;
  to: number;
  started: boolean;
}

/**
 * A short vertical list the owner reorders by its grip: drag with the pointer, or press the Up and Down arrow
 * keys on the grip. `onMove` receives the item and its new index. Rows slide with transforms while dragging, and
 * the order changes only on drop, so the list never reflows mid-drag.
 */
export function SortableList(props: {
  readonly label: string;
  readonly items: readonly SortableItem[];
  readonly onMove: (id: string, to: number) => void;
}) {
  const { items, onMove } = props;
  const list = useRef<HTMLUListElement>(null);
  const drag = useRef<Drag | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const refocus = useRef<string | null>(null);
  const [message, setMessage] = useState("");

  // Moving a row in the DOM can drop focus, so give it back to the grip that was used.
  useEffect(() => {
    const id = refocus.current;
    refocus.current = null;
    if (id === null) return;
    const grips = list.current?.querySelectorAll<HTMLElement>("[data-grip]") ?? [];
    for (const grip of grips) if (grip.dataset["grip"] === id) grip.focus({ preventScroll: true });
  });
  useEffect(() => () => cleanup.current?.(), []);

  const place = (id: string, to: number, byKey: boolean): void => {
    if (byKey) refocus.current = id;
    onMove(id, to);
    const label = items.find((item) => item.id === id)?.label ?? id;
    setMessage(`${label} moved to position ${to + 1} of ${items.length}.`);
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLButtonElement>): void => {
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    const item = items[index];
    if (step === undefined || item === undefined) return;
    event.preventDefault();
    const to = index + step;
    if (to >= 0 && to < items.length) place(item.id, to, true);
  };

  const onPointerDown = (index: number, event: PointerEvent<HTMLButtonElement>): void => {
    const item = items[index];
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(":scope > li") ?? [])];
    if (event.button !== 0 || drag.current !== null || item === undefined || rows.length < 2)
      return;
    const grip = event.currentTarget;
    const { id, label } = item;
    const state: Drag = {
      from: index,
      rows,
      slots: rows.map((row) => {
        const box = row.getBoundingClientRect();
        return { top: box.top, height: box.height };
      }),
      startY: event.clientY,
      pointerId: event.pointerId,
      to: index,
      started: false,
    };
    drag.current = state;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const layout = (shift: number): void => {
      const offsets = offsetsFor(state.slots, state.from, state.to);
      state.rows.forEach((row, at) => {
        row.style.translate = `0 ${at === state.from ? shift : (offsets[at] ?? 0)}px`;
      });
    };
    const clear = (): void => {
      for (const row of state.rows) {
        row.style.translate = "";
        row.classList.remove("dragging", "settling");
      }
      list.current?.classList.remove("sorting");
      document.documentElement.classList.remove("is-reordering");
    };
    const release = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
    };
    const finish = (drop: boolean): void => {
      release();
      if (!state.started) {
        drag.current = null;
        cleanup.current = null;
        return;
      }
      if (!drop) state.to = state.from;
      const row = state.rows[state.from];
      row?.classList.add("settling");
      layout(offsetsFor(state.slots, state.from, state.to)[state.from] ?? 0);
      const commit = (): void => {
        clear();
        drag.current = null;
        cleanup.current = null;
        if (state.to !== state.from) flushSync(() => place(id, state.to, false));
      };
      timer = setTimeout(commit, prefersReducedMotion() ? 0 : settleMs);
    };
    function move(moved: globalThis.PointerEvent): void {
      if (moved.pointerId !== state.pointerId) return;
      const travelled = moved.clientY - state.startY;
      if (!state.started) {
        if (Math.abs(travelled) <= slop) return;
        state.started = true;
        grip.setPointerCapture(state.pointerId);
        document.documentElement.classList.add("is-reordering");
        list.current?.classList.add("sorting");
        state.rows[state.from]?.classList.add("dragging");
        setMessage(`Picked up ${label}. Position ${index + 1} of ${items.length}.`);
      }
      const shift = clampShift(state.slots, state.from, travelled);
      state.to = targetIndex(state.slots, state.from, shift);
      layout(shift);
    }
    function up(lifted: globalThis.PointerEvent): void {
      if (lifted.pointerId === state.pointerId) finish(true);
    }
    function cancel(cancelled: globalThis.PointerEvent): void {
      if (cancelled.pointerId === state.pointerId) finish(false);
    }
    function key(pressed: globalThis.KeyboardEvent): void {
      if (pressed.key === "Escape") finish(false);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    cleanup.current = () => {
      release();
      clearTimeout(timer);
      clear();
      drag.current = null;
    };
  };

  return (
    <>
      <ul ref={list} className="sortlist" aria-label={props.label}>
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              className="sort-grip"
              data-grip={item.id}
              aria-label={`Reorder ${item.label}`}
              disabled={items.length < 2}
              onPointerDown={(event) => onPointerDown(index, event)}
              onKeyDown={(event) => onKeyDown(index, event)}
              onContextMenu={(event) => event.preventDefault()}
            >
              <GripIcon />
            </button>
            {item.icon}
            <span className="sort-name">{item.label}</span>
          </li>
        ))}
      </ul>
      <output className="sr" aria-live="polite" aria-atomic="true">
        {message}
      </output>
    </>
  );
}
