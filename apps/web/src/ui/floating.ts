import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import { createHoverIntent } from "./hover-intent.ts";

const edge = 10;

/** The start of a span of `size`, moved as little as needed to sit `margin` inside a viewport `limit` long. */
export function keepInView(start: number, size: number, limit: number, margin: number): number {
  return Math.max(margin, Math.min(start, limit - size - margin));
}

/** Where a layer sits against its trigger. The default is right-aligned at the panel's own width. */
interface FloatingPlacement {
  /** "start" lines the panel's left edge up with the trigger's; "end" (the default) lines up the right edges. */
  readonly align?: "start" | "end";
  /** Give the panel the trigger's width as its minimum when it opens, for a listbox under a field. */
  readonly matchWidth?: boolean;
}

/** The layer that is open now. Opening another layer closes it, so only one is ever open. */
let closeCurrent: (() => void) | null = null;

/** Hover opens a layer only for a mouse-like pointer; touch keeps tap to open. */
const finePointer = "(hover: hover) and (pointer: fine)";

function mouseOnly(act: () => void): (event: ReactPointerEvent) => void {
  return (event) => {
    if (event.pointerType === "mouse" && window.matchMedia(finePointer).matches) act();
  };
}

interface HoverHandlers {
  readonly onPointerEnter?: (event: ReactPointerEvent) => void;
  readonly onPointerLeave?: (event: ReactPointerEvent) => void;
}

export interface FloatingLayer {
  readonly open: boolean;
  readonly above: boolean;
  readonly panelId: string;
  readonly style: CSSProperties;
  readonly toggle: () => void;
  readonly show: () => void;
  /** Close the layer. Focus returns to the trigger unless `returnFocus` is false. */
  readonly hide: (returnFocus?: boolean) => void;
  /** Pointer handlers for the trigger and the panel; empty unless the layer opens on hover. */
  readonly triggerHover: HoverHandlers;
  readonly panelHover: HoverHandlers;
  /** True while the layer was opened by hover alone, so focus must stay where it is. */
  readonly openedByHover: () => boolean;
}

/**
 * State for a panel in the browser's top layer (native Popover API), placed from its trigger: right-aligned,
 * below it, flipped above when there is no room. It closes on outside press, Escape (focus returns to the
 * trigger), page scroll and resize. `gap` is the space between trigger and panel in pixels. With `hoverable`, a
 * mouse resting on the trigger opens it and leaving trigger and panel closes it after a grace delay; a click or
 * key pins it open until an outside press or Escape.
 */
export function useFloatingLayer(
  gap: number,
  hoverable = false,
  placementOptions: FloatingPlacement = {},
): {
  readonly layer: FloatingLayer;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly panelRef: RefObject<HTMLDivElement | null>;
} {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"closed" | "closed-focus" | "open">("closed");
  const open = state === "open";
  const { align = "end", matchWidth = false } = placementOptions;
  const [placement, setPlacement] = useState({ top: 0, left: 0, above: false });

  const openRef = useRef(false);
  const byHover = useRef(false);

  const hide = useCallback((returnFocus = true) => {
    setState(returnFocus ? "closed-focus" : "closed");
  }, []);
  const [hover] = useState(() =>
    createHoverIntent({
      open: () => {
        closeCurrent?.();
        byHover.current = true;
        setState("open");
      },
      close: () => setState("closed"),
      isOpen: () => openRef.current,
      timers: {
        after: (run, ms) => window.setTimeout(run, ms),
        cancel: (handle) => {
          if (typeof handle === "number") window.clearTimeout(handle);
        },
      },
    }),
  );
  const show = useCallback(() => {
    closeCurrent?.();
    byHover.current = false;
    hover.pin();
    setState("open");
  }, [hover]);
  const toggle = useCallback(() => {
    if (!open) show();
    else if (hoverable && !hover.pinned()) {
      // A click on a layer that hover opened pins it instead of closing it.
      byHover.current = false;
      hover.pin();
    } else hide();
  }, [open, hoverable, hover, show, hide]);

  useEffect(() => {
    openRef.current = open;
    if (!open) {
      byHover.current = false;
      hover.reset();
    }
  }, [open, hover]);
  useEffect(() => () => hover.reset(), [hover]);

  const openedByHover = useCallback(() => byHover.current, []);

  const hoverHandlers: HoverHandlers = hoverable
    ? { onPointerEnter: mouseOnly(hover.enter), onPointerLeave: mouseOnly(hover.leave) }
    : {};

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (panel === null || trigger === null) return;
    if (!open) {
      if (panel.matches(":popover-open")) panel.hidePopover();
      return;
    }
    if (!panel.matches(":popover-open")) panel.showPopover();
    const rect = trigger.getBoundingClientRect();
    if (matchWidth) panel.style.minWidth = `${Math.round(rect.width)}px`;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const below = rect.bottom + gap + height <= window.innerHeight - edge;
    setPlacement({
      above: !below,
      top: below ? rect.bottom + gap : Math.max(edge, rect.top - gap - height),
      left: keepInView(
        align === "start" ? rect.left : rect.right - width,
        width,
        window.innerWidth,
        edge,
      ),
    });
  }, [open, gap, align, matchWidth]);

  useEffect(() => {
    if (state === "closed-focus") triggerRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (!open) return;
    const close = (): void => setState("closed");
    closeCurrent = close;
    const onPress = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) === true) return;
      if (triggerRef.current?.contains(target) === true) return;
      close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setState("closed-focus");
    };
    const onScroll = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target) === true) return;
      close();
    };
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      if (closeCurrent === close) closeCurrent = null;
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return {
    triggerRef,
    panelRef,
    layer: {
      open,
      above: placement.above,
      panelId,
      style: { top: placement.top, left: placement.left },
      toggle,
      show,
      hide,
      triggerHover: hoverHandlers,
      panelHover: hoverHandlers,
      openedByHover,
    },
  };
}
