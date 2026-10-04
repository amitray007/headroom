/** How many top-ups show at first, and how many more each step adds. */
export const pageSize = 50;

/** The count after one more step, never past the total. */
export function nextCount(count: number, total: number): number {
  return Math.min(count + pageSize, total);
}

/**
 * Whether the shown count survives a change of list. Adding, editing or removing one top-up leaves most ids in
 * place, so it does. A different book (Demo Mode on or off) shares none, so the count starts over.
 */
export function keepsCount(previous: readonly string[], next: readonly string[]): boolean {
  if (previous.length === 0 || next.length === 0) return true;
  const known = new Set(previous);
  return next.some((id) => known.has(id));
}
