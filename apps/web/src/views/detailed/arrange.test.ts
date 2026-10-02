import { describe, expect, test } from "bun:test";

import type { OverviewConnection } from "../../api.ts";
import { connection, percent } from "../../lib/test-fixtures.ts";
import { arrange, matches, providerCounts, type ArrangeOptions } from "./arrange.ts";

const options: ArrangeOptions = {
  order: "urgency",
  providerOrder: ["claude", "codex"],
  keepInactiveLast: true,
  lowThreshold: 30,
};

const ids = (connections: readonly OverviewConnection[]): string[] =>
  connections.map((entry) => entry.id);

// Saved order: roomy claude, tight codex, paused claude, medium codex, disconnected codex.
const saved: OverviewConnection[] = [
  connection("claude", { id: "c-roomy", metrics: [percent("seven_day", 10)] }),
  connection("codex", { id: "x-tight", metrics: [percent("seven_day", 95)] }),
  connection("claude", { id: "c-paused", state: "paused", metrics: [percent("seven_day", 99)] }),
  connection("codex", { id: "x-mid", metrics: [percent("seven_day", 75)] }),
  connection("codex", { id: "x-off", state: "reconnect_required" }),
];

function at(index: number): OverviewConnection {
  const found = saved[index];
  if (found === undefined) throw new Error(`no connection at ${index}`);
  return found;
}

describe("arrange", () => {
  test("urgency puts the tightest first and inactive accounts last", () => {
    const sections = arrange(saved, options);
    expect(sections.map((section) => section.kind)).toEqual(["list", "inactive"]);
    expect(ids(sections[0]?.connections ?? [])).toEqual(["x-tight", "x-mid", "c-roomy"]);
    expect(ids(sections[1]?.connections ?? [])).toEqual(["c-paused", "x-off"]);
  });

  test("custom keeps the saved order", () => {
    const sections = arrange(saved, { ...options, order: "custom" });
    expect(ids(sections[0]?.connections ?? [])).toEqual(["c-roomy", "x-tight", "x-mid"]);
  });

  test("provider order groups by the saved provider order, accounts in saved order", () => {
    const sections = arrange(saved, {
      ...options,
      order: "provider",
      providerOrder: ["codex", "claude"],
    });
    expect(sections.map((section) => section.key)).toEqual(["codex", "claude", "inactive"]);
    expect(ids(sections[0]?.connections ?? [])).toEqual(["x-tight", "x-mid"]);
    expect(ids(sections[2]?.connections ?? [])).toEqual(["x-off", "c-paused"]);
  });

  test("inactive accounts stay in place when keepInactiveLast is off", () => {
    const sections = arrange(saved, { ...options, order: "custom", keepInactiveLast: false });
    expect(sections).toHaveLength(1);
    expect(ids(sections[0]?.connections ?? [])).toEqual(ids(saved));
  });

  test("a section with no accounts is left out", () => {
    const sections = arrange([at(0)], options);
    expect(sections.map((section) => section.kind)).toEqual(["list"]);
  });
});

describe("filter helpers", () => {
  test("matches", () => {
    expect(matches(at(0), "all")).toBe(true);
    expect(matches(at(0), "claude")).toBe(true);
    expect(matches(at(0), "codex")).toBe(false);
  });

  test("providerCounts follow the provider order", () => {
    expect(providerCounts(saved, ["codex", "claude"])).toEqual([
      { provider: "codex", count: 3 },
      { provider: "claude", count: 2 },
    ]);
  });
});
