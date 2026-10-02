import { clampShift, moveItem, offsetsFor, targetIndex, type Slot } from "../lib/reorder.ts";
import { prefersReducedMotion } from "../ui/motion.ts";

/** How far the picked-up item grows. Small: the table is wide. */
const liftScale = 1.01;
/** The settle is a spring of about 380 ms; the timer covers it. A keyboard drop is already in place. */
const settleMs = 420;
const settleKeyMs = 260;
/** Pointer distance from a viewport edge where the page starts to scroll, and the fastest speed in pixels per frame. */
const edge = 72;
const fastest = 22;

export interface DragOptions {
  /** The siblings in their current order, the dragged one among them. */
  readonly items: readonly HTMLElement[];
  readonly index: number;
  /** The element the siblings of the dragged item sit in, for the drag classes. */
  readonly scope: HTMLElement;
  /** The pointer's start, or null when the keyboard drives the drag. */
  readonly pointerY: number | null;
  /** The slot the dragged item now holds. */
  readonly onMove: (to: number) => void;
  /** Called once, after the settle and before the drag's styles go. Commit the new order synchronously here. */
  readonly onFinish: (result: { from: number; to: number } | null) => void;
}

export interface DragSession {
  /** The pointer moved. */
  pointer: (clientY: number) => void;
  /** Keyboard: move up or down a slot. Home and End pass a large step. */
  step: (by: number) => void;
  /** End the drag. `cancel` puts everything back. */
  end: (cancel: boolean) => void;
  /** Drop the drag at once with no commit: the page is going away. */
  dispose: () => void;
}

const dragClasses = ["drag-item", "drag-sib", "drag-settle", "first-slot", "last-slot"];

/**
 * A drag on a list of table rows or row groups, done with transforms: DOM order never changes during the drag,
 * so nothing reflows. The dragged item follows the pointer and is shown by a floating copy on the body; the others slide
 * to open a gap. Release settles everything on its final slot, then the caller commits the new order and the
 * transforms go in the same frame.
 */
export function startDrag(options: DragOptions): DragSession | null {
  const { items, index: from, scope } = options;
  const keyboard = options.pointerY === null;
  const reduced = prefersReducedMotion();
  const dragged = items[from];
  const slots: Slot[] = items.map((item) => {
    const box = item.getBoundingClientRect();
    return { top: box.top + window.scrollY, height: box.height };
  });
  const home = slots[from];
  if (dragged === undefined || home === undefined) return null;
  const startY = options.pointerY ?? 0;
  const startScroll = window.scrollY;
  const bounds = {
    min: clampShift(slots, from, Number.NEGATIVE_INFINITY),
    max: clampShift(slots, from, Number.POSITIVE_INFINITY),
  };

  // The floating copy: a fixed element on the body, so no table stacking rule can paint a sibling over it.
  const box = dragged.getBoundingClientRect();
  const ghost = makeGhost(dragged, scope, box);
  document.body.append(ghost);

  let to = from;
  let shift = 0;
  let lastY = startY;
  let frame = 0;
  let done = false;

  let current = 0;
  const place = (next: number): void => {
    current = next;
    // The ghost is fixed to the viewport; the offset is in page space, so scrolling is subtracted.
    ghost.style.translate = `${box.left}px ${box.top + next - (window.scrollY - startScroll)}px`;
  };
  const layout = (): void => {
    const offsets = offsetsFor(slots, from, to);
    const final = moveItem(
      items.map((_, index) => index),
      from,
      to,
    );
    items.forEach((item, index) => {
      if (index !== from) item.style.translate = `0 ${offsets[index] ?? 0}px`;
      const at = final.indexOf(index);
      item.classList.toggle("first-slot", at === 0);
      item.classList.toggle("last-slot", at === items.length - 1);
    });
    if (keyboard) place(offsets[from] ?? 0);
  };
  const update = (): void => {
    shift = clampShift(slots, from, lastY - startY + (window.scrollY - startScroll));
    const next = targetIndex(slots, from, shift);
    if (next !== to) {
      to = next;
      layout();
      options.onMove(to);
    }
    place(shift);
  };
  const scrollTick = (): void => {
    const fromTop = lastY;
    const fromBottom = window.innerHeight - lastY;
    let speed = 0;
    if (fromTop < edge) speed = -((edge - fromTop) / edge) * fastest;
    else if (fromBottom < edge) speed = ((edge - fromBottom) / edge) * fastest;
    if ((speed < 0 && shift > bounds.min) || (speed > 0 && shift < bounds.max)) {
      const before = window.scrollY;
      window.scrollBy(0, speed);
      if (window.scrollY !== before) update();
    }
    frame = requestAnimationFrame(scrollTick);
  };
  const reveal = (): void => {
    const offset = offsetsFor(slots, from, to)[from] ?? 0;
    const top = home.top + offset - window.scrollY;
    const bottom = top + home.height;
    const room = window.innerHeight - edge;
    const by = top < edge ? top - edge : bottom > room ? bottom - room : 0;
    if (by !== 0) window.scrollBy({ top: by, behavior: reduced ? "auto" : "smooth" });
  };

  // Pick up.
  document.documentElement.classList.add("is-reordering");
  for (const [index, item] of items.entries()) {
    item.classList.add(index === from ? "drag-item" : "drag-sib");
  }
  scope.classList.add("sorting");
  layout();
  place(0);
  void ghost.offsetWidth;
  if (keyboard) ghost.classList.add("drag-settle");
  if (!reduced) ghost.style.scale = String(liftScale);
  if (!keyboard) frame = requestAnimationFrame(scrollTick);
  const onScroll = (): void => {
    if (!done) place(current);
  };
  const onAway = (): void => {
    if (!done && (document.visibilityState === "hidden" || !keyboard)) session.end(true);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("blur", onAway);
  document.addEventListener("visibilitychange", onAway);

  const cleanup = (): void => {
    for (const item of items) {
      item.style.translate = "";
      item.style.scale = "";
      item.classList.remove(...dragClasses);
    }
    scope.classList.remove("sorting");
    ghost.remove();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("blur", onAway);
    document.removeEventListener("visibilitychange", onAway);
    document.documentElement.classList.remove("is-reordering");
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const session: DragSession = {
    pointer(clientY) {
      if (done || keyboard) return;
      lastY = clientY;
      update();
    },
    step(by) {
      if (done || !keyboard) return;
      const next = Math.max(0, Math.min(items.length - 1, to + by));
      if (next === to) return;
      to = next;
      layout();
      options.onMove(to);
      reveal();
    },
    end(cancel) {
      if (done) return;
      done = true;
      cancelAnimationFrame(frame);
      const target = cancel ? from : to;
      to = target;
      layout();
      place(offsetsFor(slots, from, target)[from] ?? 0);
      ghost.classList.add("drag-settle");
      ghost.style.scale = "";
      timer = setTimeout(
        () => {
          options.onFinish(target === from ? null : { from, to: target });
          cleanup();
        },
        reduced ? 0 : keyboard && !cancel ? settleKeyMs : settleMs,
      );
    },
    dispose() {
      done = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      cleanup();
    },
  };
  return session;
}

/** A body-level copy of the dragged group or row, in a table whose columns match the live one. */
function makeGhost(dragged: HTMLElement, scope: HTMLElement, box: DOMRect): HTMLElement {
  const live = scope.closest("table");
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  Object.assign(ghost.style, { width: `${box.width}px`, height: `${box.height}px` });
  const table = document.createElement("table");
  table.className = "accounts";
  table.style.width = `${box.width}px`;
  table.style.tableLayout = "fixed";
  const cols = document.createElement("colgroup");
  for (const cell of live?.querySelectorAll("thead th") ?? []) {
    const col = document.createElement("col");
    col.style.width = `${cell.getBoundingClientRect().width}px`;
    cols.append(col);
  }
  table.append(cols);
  const copy = dragged.cloneNode(true);
  if (!(copy instanceof HTMLElement)) return ghost;
  for (const node of [copy, ...copy.querySelectorAll("[id]")]) node.removeAttribute("id");
  for (const node of [
    copy,
    ...copy.querySelectorAll("[data-handle], [data-provider], [data-account]"),
  ]) {
    for (const name of ["data-handle", "data-provider", "data-account"]) node.removeAttribute(name);
  }
  if (copy.tagName === "TR") {
    const body = document.createElement("tbody");
    body.append(copy);
    table.append(body);
  } else table.append(copy);
  ghost.append(table);
  return ghost;
}
