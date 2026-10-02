import { useLayoutEffect, useRef, type ReactNode } from "react";

import { cx } from "./cx.ts";
import { prefersReducedMotion } from "./motion.ts";
import "./slide-swap.css";

export type SwapDirection = "next" | "prev" | "swap";

const slide = 40;
const enterMs = 380;
const leaveMs = 220;
const ghostClass = "slide-swap-ghost";

/**
 * Content that changes without a collapsed frame. When `swapKey` changes the old content stays on top as a
 * fading copy, the new content fades (and slides sideways for "next" and "prev") in beneath it, and the
 * height runs from the old value to the new one. Other changes of `children` show at once. Under reduced
 * motion, or while hidden, the change is instant. `direction` is read when the key changes.
 *
 * The old content is a plain DOM copy taken after the previous render: it is inert and aria-hidden, so it
 * needs no state and nothing in it can be used while it fades.
 */
export function SlideSwap(props: {
  readonly swapKey: string;
  readonly direction: SwapDirection;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const { swapKey, direction } = props;
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const last = useRef<{ key: string; copy: HTMLElement | null; height: number }>({
    key: swapKey,
    copy: null,
    height: 0,
  });

  useLayoutEffect(() => {
    const rootEl = root.current;
    const bodyEl = body.current;
    if (rootEl === null || bodyEl === null) return;
    const before = last.current;
    // The body keeps its natural height while the root's height animates, so this is always the real one.
    const height = bodyEl.getBoundingClientRect().height;
    if (before.key !== swapKey) {
      for (const animation of [...rootEl.getAnimations(), ...bodyEl.getAnimations()]) {
        animation.cancel();
      }
      for (const old of rootEl.querySelectorAll(`:scope > .${ghostClass}`)) old.remove();
      if (before.copy !== null && !prefersReducedMotion() && rootEl.offsetParent !== null) {
        const shift = direction === "next" ? slide : direction === "prev" ? -slide : 0;
        const rise = direction === "swap" ? 6 : 0;
        const ghost = before.copy;
        ghost.className = ghostClass;
        ghost.inert = true;
        ghost.setAttribute("aria-hidden", "true");
        rootEl.append(ghost);
        bodyEl.animate(
          [
            { opacity: 0, transform: `translate(${shift}px, ${rise}px)` },
            { opacity: 1, transform: "none" },
          ],
          { duration: enterMs, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
        );
        ghost
          .animate(
            [
              { opacity: 1, transform: "none" },
              { opacity: 0, transform: `translate(${-shift / 2}px, 0)` },
            ],
            { duration: leaveMs, easing: "ease-out", fill: "forwards" },
          )
          .addEventListener("finish", () => ghost.remove());
        if (Math.abs(before.height - height) > 1) {
          rootEl.animate([{ height: `${before.height}px` }, { height: `${height}px` }], {
            duration: enterMs,
            easing: "cubic-bezier(0.65, 0, 0.35, 1)",
          });
        }
      }
    }
    const copy = bodyEl.cloneNode(true);
    last.current = { key: swapKey, copy: copy instanceof HTMLElement ? copy : null, height };
  });

  return (
    <div ref={root} className={cx("slide-swap", props.className)}>
      <div ref={body}>{props.children}</div>
    </div>
  );
}
