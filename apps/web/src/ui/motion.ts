/** True when the visitor asked for less motion. Read at call time so a changed setting applies at once. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
