import { useEffect, useState, type RefObject } from "react";

import { prefersReducedMotion } from "./motion.ts";

/**
 * True once the element has been at least `threshold` visible, and from then on. Reduced motion, and a browser
 * without IntersectionObserver, count as seen at once, so a chart waiting for this still draws.
 */
export function useInView(ref: RefObject<Element | null>, threshold = 0.35): boolean {
  const [seen, setSeen] = useState(
    () => prefersReducedMotion() || typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const node = ref.current;
    if (node === null || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setSeen(true);
        observer.disconnect();
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, seen, threshold]);
  return seen;
}
