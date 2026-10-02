import { clampShift, moveItem, offsetsFor, targetIndex, type Slot } from "../lib/reorder.ts";
import { prefersReducedMotion } from "../ui/motion.ts";

/** How far the picked-up item grows. Small: the table is wide. */
const liftScale = 1.01;
/** The settle is a spring of about 380 ms; the timer covers it. A keyboard drop is already in place. */
const settleMs = 420;
const settleKeyMs = 260;
/** Pointer distance from a viewport edge where the page starts to scroll, and the fastest speed in pixels per frame. */
const edge = 72;
/** The lifted surface stops short of the card's sides, so its shadow shows there. */
const inset = 4;
const fastest = 22;

export interface DragOptions {
  /** The siblings in their current order, the dragged one among them. */
  readonly items: readonly HTMLElement[];
  readonly index: number;
  /** The scroller that holds the table. The lifted surface is placed inside it. */
  readonly host: HTMLElement;
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
}

const dragClasses = ["drag-item", "drag-sib", "drag-settle", "first-slot", "last-slot"];

/**
 * A drag on a list of table rows or row groups, done with transforms: DOM order never changes during the drag,
 * so nothing reflows. The dragged item follows the pointer and carries a lifted surface; the others slide
 * to open a gap. Release settles everything on its final slot, then the caller commits the new order and the
 * transforms go in the same frame.
 */
export function startDrag(options: DragOptions): DragSession | null {
  const { items, index: from, host, scope } = options;
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

  // The lifted surface: a box behind the dragged item that carries the raised background and the shadow.
  const box = dragged.getBoundingClientRect();
  const hostBox = host.getBoundingClientRect();
  const surface = document.createElement("div");
  surface.className = "drag-lift";
  surface.setAttribute("aria-hidden", "true");
  Object.assign(surface.style, {
    top: `${box.top - hostBox.top + host.scrollTop}px`,
    left: `${box.left - hostBox.left + host.scrollLeft + inset}px`,
    width: `${box.width - inset * 2}px`,
    height: `${box.height}px`,
  });
  host.append(surface);

  let to = from;
  let shift = 0;
  let lastY = startY;
  let frame = 0;
  let done = false;

  const place = (offset: number): void => {
    dragged.style.translate = `0 ${offset}px`;
    surface.style.translate = `0 ${offset}px`;
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
  if (keyboard) dragged.classList.add("drag-settle");
  scope.classList.add("sorting");
  layout();
  void surface.offsetWidth;
  surface.classList.add("on");
  if (!reduced) {
    dragged.style.scale = String(liftScale);
    surface.style.scale = String(liftScale);
  }
  if (keyboard) place(0);
  else {
    frame = requestAnimationFrame(scrollTick);
    place(0);
  }

  const cleanup = (): void => {
    for (const item of items) {
      item.style.translate = "";
      item.style.scale = "";
      item.classList.remove(...dragClasses);
    }
    scope.classList.remove("sorting");
    surface.remove();
    document.documentElement.classList.remove("is-reordering");
  };

  return {
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
      dragged.classList.add("drag-settle");
      surface.classList.add("drag-settle");
      surface.classList.remove("on");
      dragged.style.scale = "";
      surface.style.scale = "";
      setTimeout(
        () => {
          options.onFinish(target === from ? null : { from, to: target });
          cleanup();
        },
        reduced ? 0 : keyboard && !cancel ? settleKeyMs : settleMs,
      );
    },
  };
}
