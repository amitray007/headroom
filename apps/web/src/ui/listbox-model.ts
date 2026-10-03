/** Pure parts of the listbox that `Select` and the currency menu share. */

/** Items under one heading, in the order the headings first appear. Items without a group come first, unheaded. */
export interface ListSection<T> {
  readonly heading: string | null;
  readonly items: readonly T[];
}

/**
 * Gather items by `group`. A heading sits over every item that names it, even when those items were not adjacent
 * in the input, and the headings keep the order they first appeared in. Ungrouped items keep their own place:
 * they form an unheaded section at the start.
 */
export function groupItems<T extends { readonly group?: string | undefined }>(
  items: readonly T[],
): ListSection<T>[] {
  const loose: T[] = [];
  const named = new Map<string, T[]>();
  for (const item of items) {
    if (item.group === undefined) {
      loose.push(item);
      continue;
    }
    const bucket = named.get(item.group);
    if (bucket === undefined) named.set(item.group, [item]);
    else bucket.push(item);
  }
  const sections: ListSection<T>[] = [];
  if (loose.length > 0) sections.push({ heading: null, items: loose });
  for (const [heading, bucket] of named) sections.push({ heading, items: bucket });
  return sections;
}

/** How long a pause ends a typeahead query, in milliseconds. */
export const typeaheadWindow = 700;

/**
 * The index a typeahead query lands on, or -1. The query is matched against the start of each label, ignoring
 * case. The search begins at `current`, so a query that still matches the active row stays on it. One character
 * (or one character repeated, as in "ccc") steps to the next label that starts with it, wrapping round.
 */
export function typeaheadMatch(labels: readonly string[], query: string, current: number): number {
  if (labels.length === 0 || query === "") return -1;
  const text = query.toLowerCase();
  const first = text.charAt(0);
  const repeated = text.length > 1 && text.split("").every((char) => char === first);
  const needle = repeated ? first : text;
  const from = needle.length === 1 && current >= 0 ? current + 1 : Math.max(current, 0);
  for (let step = 0; step < labels.length; step++) {
    const index = (from + step) % labels.length;
    if ((labels[index] ?? "").toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

/** Add a typed key to the running query, or start a new one when the pause was too long. */
export function extendQuery(
  previous: { text: string; at: number },
  key: string,
  now: number,
): string {
  return now - previous.at > typeaheadWindow ? key : previous.text + key;
}
