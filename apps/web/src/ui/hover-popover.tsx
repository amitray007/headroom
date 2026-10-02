import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { Tone } from "../lib/tone.ts";
import { keepInView } from "./floating.ts";
import "./hover-popover.css";

/** What the popover says: a title, one line of timing, then facts. A fact may carry a tone dot. */
export interface PopoverContent {
  readonly title: string;
  readonly when?: string;
  readonly lines: readonly { readonly text: string; readonly tone?: Tone | null }[];
}

/** The attribute a target carries; its value names the content. */
const popoverAttribute = "data-tip";

interface Shown {
  readonly content: PopoverContent;
  readonly anchor: HTMLElement;
  /** Pointer x, so the popover follows the pointer along a wide target; null for keyboard focus. */
  readonly x: number | null;
  readonly open: boolean;
  /** The resolver the content came from; content from an older one is stale. */
  readonly source: (id: string) => PopoverContent | null;
}

const margin = 8;
const gap = 8;

function targetOf(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const found = target.closest<HTMLElement>(`[${popoverAttribute}]`);
  return found;
}

/**
 * One app-style popover for many targets. Any element with `data-tip="id"` opens it on hover or keyboard focus
 * (and on press, for touch); Escape, scrolling and resizing close it. `resolve` maps the id to content, and a
 * new `resolve` closes the popover. The popover sits in the page's top layer of the body, above or below the
 * target, and never takes the pointer. Targets should be buttons so the keyboard reaches them, and should
 * carry the same words in `aria-label`: the popover itself is hidden from assistive tech.
 */
export function HoverPopover(props: { readonly resolve: (id: string) => PopoverContent | null }) {
  const { resolve } = props;
  const pop = useRef<HTMLDivElement>(null);
  const resolver = useRef(resolve);
  const [shown, setShown] = useState<Shown | null>(null);
  const [below, setBelow] = useState(false);

  useEffect(() => {
    resolver.current = resolve;
  }, [resolve]);

  useEffect(() => {
    const show = (anchor: HTMLElement, x: number | null): void => {
      const content = resolver.current(anchor.getAttribute(popoverAttribute) ?? "");
      if (content !== null) setShown({ content, anchor, x, open: true, source: resolver.current });
    };
    const hide = (): void =>
      setShown((current) => (current === null ? null : { ...current, open: false }));
    const isShownAnchor = (el: HTMLElement | null, current: Shown | null): boolean =>
      el !== null && current !== null && current.open && current.anchor === el;

    const over = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      const el = targetOf(event);
      if (el !== null) show(el, event.clientX);
    };
    const move = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      const el = targetOf(event);
      if (el === null) return;
      setShown((current) =>
        isShownAnchor(el, current) && current !== null ? { ...current, x: event.clientX } : current,
      );
    };
    const out = (event: PointerEvent): void => {
      if (event.pointerType === "touch") return;
      const el = targetOf(event);
      if (el === null) return;
      if (event.relatedTarget instanceof Node && el.contains(event.relatedTarget)) return;
      if (document.activeElement === el && el.matches(":focus-visible")) return;
      setShown((current) => (current?.anchor === el ? { ...current, open: false } : current));
    };
    const focusIn = (event: FocusEvent): void => {
      const el = targetOf(event);
      if (el !== null && el.matches(":focus-visible")) show(el, null);
    };
    const focusOut = (event: FocusEvent): void => {
      const el = targetOf(event);
      setShown((current) =>
        el !== null && current?.anchor === el ? { ...current, open: false } : current,
      );
    };
    const click = (event: MouseEvent): void => {
      const el = targetOf(event);
      if (el === null) hide();
      else show(el, event.clientX);
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    document.addEventListener("click", click);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      document.removeEventListener("click", click);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide);
      window.removeEventListener("resize", hide);
    };
  }, []);

  useLayoutEffect(() => {
    const el = pop.current;
    if (el === null || shown === null) return;
    const rect = shown.anchor.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const center = Math.min(rect.right, Math.max(rect.left, shown.x ?? rect.left + rect.width / 2));
    const left = keepInView(center - width / 2, width, window.innerWidth, margin);
    const above = rect.top - height - gap;
    const useBelow = above < margin;
    el.style.left = `${left}px`;
    el.style.top = `${useBelow ? rect.bottom + gap : above}px`;
    setBelow((was) => (was === useBelow ? was : useBelow));
  }, [shown]);

  if (typeof document === "undefined") return null;
  const content = shown?.content;
  // New data replaces the resolver; a popover from the old one closes rather than show stale words.
  const open = shown !== null && shown.open && shown.source === resolve;
  return createPortal(
    <div ref={pop} className="hover-pop" data-open={open} data-below={below} aria-hidden="true">
      {content === undefined ? null : (
        <>
          <strong>{content.title}</strong>
          {content.when === undefined ? null : (
            <span className="hover-pop-when">{content.when}</span>
          )}
          {content.lines.map((line) => (
            <span key={line.text} className="hover-pop-line" data-tone={line.tone ?? undefined}>
              {line.tone === undefined || line.tone === null ? null : <i />}
              {line.text}
            </span>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}
