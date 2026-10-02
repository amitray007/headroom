/** Wait before a resting pointer opens a layer, so a pointer passing over the trigger opens nothing. */
export const hoverOpenDelay = 120;
/** Wait after the pointer left the trigger and the panel, long enough to cross the gap between them. */
export const hoverCloseDelay = 250;

export interface HoverTimers {
  readonly after: (run: () => void, ms: number) => unknown;
  readonly cancel: (handle: unknown) => void;
}

export interface HoverIntent {
  /** The pointer is over the trigger or the panel. */
  readonly enter: () => void;
  /** The pointer left the trigger or the panel. */
  readonly leave: () => void;
  /** A click or key opened the layer for good: leaving no longer closes it. */
  readonly pin: () => void;
  /** The layer closed: forget the pin and any pending timer. */
  readonly reset: () => void;
  readonly pinned: () => boolean;
}

/**
 * The timing of hover-to-open. Open after the pointer rests on the trigger, close a grace period after it left
 * both trigger and panel, and never close a pinned layer. The layer reports its own state through `isOpen`.
 */
export function createHoverIntent(options: {
  readonly open: () => void;
  readonly close: () => void;
  readonly isOpen: () => boolean;
  readonly timers: HoverTimers;
}): HoverIntent {
  const { timers } = options;
  let pending: unknown = null;
  let isPinned = false;
  const clear = (): void => {
    if (pending !== null) timers.cancel(pending);
    pending = null;
  };
  return {
    enter: () => {
      clear();
      if (options.isOpen()) return;
      pending = timers.after(() => {
        pending = null;
        options.open();
      }, hoverOpenDelay);
    },
    leave: () => {
      clear();
      if (isPinned || !options.isOpen()) return;
      pending = timers.after(() => {
        pending = null;
        options.close();
      }, hoverCloseDelay);
    },
    pin: () => {
      clear();
      isPinned = true;
    },
    reset: () => {
      clear();
      isPinned = false;
    },
    pinned: () => isPinned,
  };
}
