import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

const edge = 10;

/** The layer that is open now. Opening another layer closes it, so only one is ever open. */
let closeCurrent: (() => void) | null = null;

export interface FloatingLayer {
  readonly open: boolean;
  readonly above: boolean;
  readonly panelId: string;
  readonly style: CSSProperties;
  readonly toggle: () => void;
  readonly show: () => void;
  /** Close the layer. Focus returns to the trigger unless `returnFocus` is false. */
  readonly hide: (returnFocus?: boolean) => void;
}

/**
 * State for a panel in the browser's top layer (native Popover API), placed from its trigger: right-aligned,
 * below it, flipped above when there is no room. It closes on outside press, Escape (focus returns to the
 * trigger), page scroll and resize. `gap` is the space between trigger and panel in pixels.
 */
export function useFloatingLayer(gap: number): {
  readonly layer: FloatingLayer;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly panelRef: RefObject<HTMLDivElement | null>;
} {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"closed" | "closed-focus" | "open">("closed");
  const open = state === "open";
  const [placement, setPlacement] = useState({ top: 0, left: 0, above: false });

  const hide = useCallback((returnFocus = true) => {
    setState(returnFocus ? "closed-focus" : "closed");
  }, []);
  const show = useCallback(() => {
    closeCurrent?.();
    setState("open");
  }, []);
  const toggle = useCallback(() => {
    if (open) hide();
    else show();
  }, [open, hide, show]);

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
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const below = rect.bottom + gap + height <= window.innerHeight - edge;
    setPlacement({
      above: !below,
      top: below ? rect.bottom + gap : Math.max(edge, rect.top - gap - height),
      left: Math.max(edge, Math.min(rect.right - width, window.innerWidth - width - edge)),
    });
  }, [open, gap]);

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
    },
  };
}
