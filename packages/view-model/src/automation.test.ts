import { describe, expect, test } from "bun:test";

import { autoResetAccounts, autoResetSummary, spendLabel, spendRows } from "./automation.ts";
import { connection, metric } from "./test-fixtures.ts";

const spend = (key: string, value: number | null, unit = "USD", over = {}) =>
  metric(key, {
    kind: "spend",
    unit,
    scope: "month",
    valueNum: value,
    valueText: value === null ? null : String(value),
    availability: value === null ? "temporarily_unavailable" : "available",
    ...over,
  });

describe("autoResetAccounts", () => {
  test("keeps accounts whose connector can use a banked reset", () => {
    const codex = connection("codex", {
      id: "x1",
      actions: { enabled: false, supported: ["consume_reset_credit"] },
    });
    const claude = connection("claude", { id: "c1" });
    expect(autoResetAccounts([claude, codex]).map((item) => item.id)).toEqual(["x1"]);
    expect(autoResetAccounts([])).toEqual([]);
  });
});

describe("autoResetSummary", () => {
  test("states the window, the threshold and the time left", () => {
    expect(
      autoResetSummary({ enabled: true, window: "weekly", thresholdPercent: 95, minHoursLeft: 24 }),
    ).toBe(
      "Uses the banked reset that expires first when a weekly limit reaches 95% used and its own reset is more than 24 hours away.",
    );
    expect(
      autoResetSummary({ enabled: true, window: "either", thresholdPercent: 100, minHoursLeft: 1 }),
    ).toContain(
      "a weekly or 5-hour limit reaches 100% used and its own reset is more than 1 hour away",
    );
  });
});

describe("spendLabel", () => {
  test("names each spend figure as the notices do", () => {
    expect(spendLabel("claude", "extra_usage.used")).toBe("Extra Usage");
    expect(spendLabel("cursor", "on_demand.used")).toBe("On-Demand Spend");
    expect(spendLabel("grok", "on_demand.used")).toBe("On-Demand Use");
    expect(spendLabel("vercel_ai_gateway", "spend.30d")).toBe("30-Day Spend");
    expect(spendLabel("codex", "something.else")).toBe("something.else");
  });
});

describe("spendRows", () => {
  test("lists each spend metric with its unit, value and budget", () => {
    const cursor = connection("cursor", {
      id: "k1",
      metrics: [
        metric("included.total_percent", { valueNum: 20, valueText: "20" }),
        spend("on_demand.used", 12.5),
      ],
      automation: {
        autoReset: null,
        budgets: [{ metricKey: "on_demand.used", amount: 50, unit: "USD" }],
      },
    });
    const grok = connection("grok", {
      id: "g1",
      metrics: [spend("on_demand.used", 40, "grok_credits")],
    });
    const rows = spendRows([cursor, grok]);
    expect(
      rows.map((row) => [row.connection.id, row.label, row.unit, row.value, row.budget?.amount]),
    ).toEqual([
      ["k1", "On-Demand Spend", "USD", 12.5, 50],
      ["g1", "On-Demand Use", "credits", 40, undefined],
    ]);
  });
  test("an unavailable figure is listed only while it has a budget, and its value is unknown", () => {
    const bare = connection("vercel_ai_gateway", {
      id: "v1",
      metrics: [spend("spend.30d", null)],
    });
    expect(spendRows([bare])).toEqual([]);
    const budgeted = connection("vercel_ai_gateway", {
      id: "v2",
      metrics: [spend("spend.30d", null)],
      automation: {
        autoReset: null,
        budgets: [{ metricKey: "spend.30d", amount: 80, unit: "USD" }],
      },
    });
    const [row] = spendRows([budgeted]);
    expect(row?.value).toBeNull();
    expect(row?.budget?.amount).toBe(80);
  });
  test("an account with no reading has no rows", () => {
    expect(spendRows([connection("claude", { snapshot: null })])).toEqual([]);
  });
});
