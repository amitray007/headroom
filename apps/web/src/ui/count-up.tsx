import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "./motion.ts";

const duration = 580;
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 4);

/**
 * A number that counts up from zero once on mount and between values when `value` changes. `delay` staggers
 * the first count in milliseconds. Reduced motion shows the value at once.
 */
export function CountUp(props: {
  readonly value: number;
  readonly decimals?: number;
  readonly prefix?: string;
  readonly delay?: number;
}) {
  const { value, decimals = 0, prefix = "", delay = 0 } = props;
  const reduced = prefersReducedMotion();
  const [shown, setShown] = useState(() => (reduced ? value : 0));
  const current = useRef(shown);
  const startDelay = useRef(delay);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const from = current.current;
    const wait = startDelay.current;
    startDelay.current = 0;
    let frame = 0;
    let start: number | undefined;
    const step = (now: number): void => {
      start ??= now + wait;
      const t = Math.min(Math.max((now - start) / duration, 0), 1);
      current.current = from + (value - from) * easeOut(t);
      setShown(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  const text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(reduced ? value : shown);
  return <span className="num">{prefix + text}</span>;
}
