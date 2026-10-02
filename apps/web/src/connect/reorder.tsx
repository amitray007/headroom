import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

import type { Provider } from "@headroom/core/contracts";

import { GripIcon } from "../icons.tsx";
import { startDrag, type DragSession } from "./drag.ts";

/** A drop that changed the order. `to` is the new index among the siblings. */
export type OrderChange =
  | { readonly kind: "provider"; readonly provider: Provider; readonly to: number }
  | {
      readonly kind: "account";
      readonly provider: Provider;
      readonly id: string;
      readonly to: number;
    };

export interface HandleSpec {
  readonly kind: "provider" | "account";
  readonly provider: Provider;
  /** The account id; for a provider, the provider itself. */
  readonly id: string;
  /** The name read aloud: "Claude", "Personal". */
  readonly label: string;
}

/** A touch press must hold this long before the drag starts, so a swipe on the table still scrolls. */
const holdMs = 150;
/** A mouse press must move this far before the drag starts, so a click on the handle does nothing. */
const slop = 3;
const helpId = "reorder-help";

const help =
  "Press Space or Enter to pick up, the arrow keys to move, Space or Enter to drop, Escape to cancel.";

interface Pending {
  readonly spec: HandleSpec;
  readonly handle: HTMLElement;
  readonly x: number;
  readonly y: number;
  readonly pointerId: number;
  readonly touch: boolean;
}

/**
 * Drag to reorder for the accounts table: provider groups among each other, accounts within their provider.
 * Only a handle starts a drag. Returns `handle` (render one per row), `status` (a live region and the help
 * text; render it once in the table card) and `sorting` (true while a drag runs).
 */
export function useReorder(options: {
  readonly table: RefObject<HTMLTableElement | null>;
  readonly host: RefObject<HTMLElement | null>;
  /** Commit the change. Runs inside a synchronous render, so the new order shows before the drag's styles go. */
  readonly onReorder: (change: OrderChange) => void;
}): { handle: (spec: HandleSpec) => ReactNode; status: ReactNode } {
  const { table, host, onReorder } = options;
  const session = useRef<DragSession | null>(null);
  const keyboard = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  const reorder = useRef(onReorder);
  const [message, setMessage] = useState("");
  useEffect(() => {
    reorder.current = onReorder;
  });
  // Leaving the page mid-drag ends the drag cleanly.
  useEffect(
    () => () => {
      stop.current?.();
      session.current?.end(true);
    },
    [],
  );

  const begin = useCallback(
    (spec: HandleSpec, pointerY: number | null): boolean => {
      const root = table.current;
      const scroller = host.current;
      if (root === null || scroller === null || session.current !== null) return false;
      let items: HTMLElement[];
      let scope: HTMLElement;
      let total: number;
      if (spec.kind === "provider") {
        scope = root;
        items = [...root.querySelectorAll<HTMLElement>(":scope > tbody[data-provider]")];
        total = items.length;
      } else {
        const body = root.querySelector<HTMLElement>(`tbody[data-provider="${spec.provider}"]`);
        if (body === null) return false;
        scope = body;
        items = [...body.querySelectorAll<HTMLElement>(":scope > tr[data-account]")];
        total = items.length;
      }
      const index = items.findIndex((item) =>
        spec.kind === "provider"
          ? item.getAttribute("data-provider") === spec.id
          : item.getAttribute("data-account") === spec.id,
      );
      if (index < 0 || total < 2) return false;
      keyboard.current = pointerY === null;
      setMessage(`Picked up ${spec.label}. Position ${index + 1} of ${total}.`);
      const started = startDrag({
        items,
        index,
        host: scroller,
        scope,
        pointerY,
        onMove: (to) => setMessage(`Moved to position ${to + 1} of ${total}.`),
        onFinish: (result) => {
          const wasKeyboard = keyboard.current;
          session.current = null;
          if (result !== null) {
            const change: OrderChange =
              spec.kind === "provider"
                ? { kind: "provider", provider: spec.provider, to: result.to }
                : { kind: "account", provider: spec.provider, id: spec.id, to: result.to };
            flushSync(() => reorder.current(change));
          }
          if (wasKeyboard) {
            root
              .querySelector<HTMLElement>(`[data-handle="${spec.kind}:${spec.id}"]`)
              ?.focus({ preventScroll: true });
          }
        },
      });
      if (started === null) return false;
      session.current = started;
      return true;
    },
    [table, host],
  );

  const finish = useCallback((cancel: boolean): void => {
    session.current?.end(cancel);
    setMessage(cancel ? "Cancelled." : "Dropped.");
  }, []);

  const onPointerDown = useCallback(
    (spec: HandleSpec, event: PointerEvent<HTMLButtonElement>): void => {
      if (event.button !== 0 || session.current !== null) return;
      const pending: Pending = {
        spec,
        handle: event.currentTarget,
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        touch: event.pointerType === "touch",
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let started = false;
      const release = (): void => {
        clearTimeout(timer);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", key);
        stop.current = null;
      };
      const start = (y: number): void => {
        if (started) return;
        started = true;
        if (!begin(spec, y)) {
          release();
          return;
        }
        pending.handle.setPointerCapture(pending.pointerId);
        if (pending.touch && "vibrate" in navigator) navigator.vibrate(8);
      };
      function move(moved: globalThis.PointerEvent): void {
        if (moved.pointerId !== pending.pointerId) return;
        if (!started) {
          const far = Math.hypot(moved.clientX - pending.x, moved.clientY - pending.y);
          if (pending.touch && far > 10) release();
          else if (!pending.touch && far > slop) start(moved.clientY);
          return;
        }
        session.current?.pointer(moved.clientY);
      }
      function up(lifted: globalThis.PointerEvent): void {
        if (lifted.pointerId !== pending.pointerId) return;
        const wasStarted = started;
        release();
        if (!wasStarted) return;
        // Dropped beside the table: the move is cancelled.
        const area = host.current?.getBoundingClientRect();
        const outside =
          area !== undefined && (lifted.clientX < area.left || lifted.clientX > area.right);
        finish(outside);
      }
      function cancel(cancelled: globalThis.PointerEvent): void {
        if (cancelled.pointerId !== pending.pointerId) return;
        const wasStarted = started;
        release();
        if (wasStarted) finish(true);
      }
      function key(pressed: globalThis.KeyboardEvent): void {
        if (pressed.key !== "Escape") return;
        const wasStarted = started;
        release();
        if (wasStarted) finish(true);
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", key);
      stop.current = release;
      if (pending.touch) timer = setTimeout(() => start(pending.y), holdMs);
    },
    [begin, finish, host],
  );

  const onKeyDown = useCallback(
    (spec: HandleSpec, event: KeyboardEvent<HTMLButtonElement>): void => {
      const active = session.current !== null && keyboard.current;
      const act = event.key === " " || event.key === "Enter";
      if (!active) {
        if (act && session.current === null) {
          event.preventDefault();
          begin(spec, null);
        }
        return;
      }
      if (act) {
        event.preventDefault();
        finish(false);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        session.current?.step(event.key === "ArrowUp" ? -1 : 1);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        session.current?.step(event.key === "Home" ? -999 : 999);
      }
    },
    [begin, finish],
  );

  const handle = (spec: HandleSpec): ReactNode => (
    <button
      type="button"
      className="drag-handle"
      data-handle={`${spec.kind}:${spec.id}`}
      aria-label={`Reorder ${spec.label}`}
      aria-describedby={helpId}
      onPointerDown={(event) => onPointerDown(spec, event)}
      onKeyDown={(event) => onKeyDown(spec, event)}
      onBlur={() => {
        if (session.current !== null && keyboard.current) finish(true);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <GripIcon />
    </button>
  );

  const status = (
    <>
      <p id={helpId} className="sr">
        {help}
      </p>
      <output className="sr" aria-live="polite" aria-atomic="true">
        {message}
      </output>
    </>
  );
  return { handle, status };
}
