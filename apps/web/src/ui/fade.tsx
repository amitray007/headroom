import { useEffect, useState, type ReactNode } from "react";

import { cx } from "./cx.ts";
import { prefersReducedMotion } from "./motion.ts";

/**
 * A span whose content changes by fading out, swapping, and fading in. Changes of `swapKey` fade; other
 * changes of `children` show at once. Used for button labels and the panel status slot.
 */
export function Fade(props: {
  readonly swapKey: string;
  readonly className?: string;
  readonly fadingClassName?: string;
  readonly delay?: number;
  readonly children: ReactNode;
}) {
  const { swapKey, children, delay = 120 } = props;
  const [shown, setShown] = useState({ key: swapKey, node: children });
  const settled = shown.key === swapKey;
  useEffect(() => {
    if (settled) return;
    const swap = () => setShown({ key: swapKey, node: children });
    if (prefersReducedMotion()) {
      swap();
      return;
    }
    const timer = setTimeout(swap, delay);
    return () => clearTimeout(timer);
  }, [settled, swapKey, children, delay]);
  return (
    <span className={cx(props.className, !settled && (props.fadingClassName ?? "fading"))}>
      {settled ? children : shown.node}
    </span>
  );
}
