import { describe, expect, test } from "bun:test";

import { extendQuery, groupItems, typeaheadMatch } from "./listbox-model.ts";

describe("groupItems", () => {
  test("gathers items under headings in first-seen order", () => {
    const sections = groupItems([
      { id: 1, group: "Claude" },
      { id: 2, group: "Codex" },
      { id: 3, group: "Claude" },
    ]);
    expect(sections.map((section) => section.heading)).toEqual(["Claude", "Codex"]);
    expect(sections[0]?.items.map((item) => item.id)).toEqual([1, 3]);
  });

  test("puts ungrouped items first, without a heading", () => {
    const sections = groupItems([{ id: 1, group: "A" }, { id: 2 }]);
    expect(sections[0]?.heading).toBeNull();
    expect(sections[0]?.items.map((item) => item.id)).toEqual([2]);
    expect(sections[1]?.heading).toBe("A");
  });

  test("returns nothing for no items", () => {
    expect(groupItems([])).toEqual([]);
  });
});

describe("typeaheadMatch", () => {
  const labels = ["Claude", "Codex", "Copilot", "Cursor", "Grok"];

  test("one letter steps to the next label that starts with it", () => {
    expect(typeaheadMatch(labels, "c", 0)).toBe(1);
    expect(typeaheadMatch(labels, "c", 1)).toBe(2);
    expect(typeaheadMatch(labels, "c", 3)).toBe(0);
  });

  test("a longer query narrows from the active row", () => {
    expect(typeaheadMatch(labels, "co", 0)).toBe(1);
    expect(typeaheadMatch(labels, "cop", 1)).toBe(2);
    expect(typeaheadMatch(labels, "cu", 0)).toBe(3);
  });

  test("a repeated letter cycles", () => {
    expect(typeaheadMatch(labels, "cc", 0)).toBe(1);
    expect(typeaheadMatch(labels, "ccc", 1)).toBe(2);
  });

  test("ignores case and reports no match", () => {
    expect(typeaheadMatch(labels, "G", -1)).toBe(4);
    expect(typeaheadMatch(labels, "x", 0)).toBe(-1);
    expect(typeaheadMatch([], "a", 0)).toBe(-1);
    expect(typeaheadMatch(labels, "", 0)).toBe(-1);
  });

  test("starts from the top when nothing is active", () => {
    expect(typeaheadMatch(labels, "c", -1)).toBe(0);
  });
});

describe("extendQuery", () => {
  test("appends inside the window and restarts after a pause", () => {
    expect(extendQuery({ text: "c", at: 1000 }, "o", 1300)).toBe("co");
    expect(extendQuery({ text: "co", at: 1000 }, "p", 2000)).toBe("p");
  });
});
