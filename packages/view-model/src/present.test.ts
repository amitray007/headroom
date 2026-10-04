import { describe, expect, test } from "bun:test";

import { connection, credit, metric, percent } from "./test-fixtures.ts";
import { formatNumber, formatUsd, presentPanel, type Cell } from "./present.ts";

const reset = new Date(2025, 9, 2, 15, 6).getTime();

function meters(cells: readonly Cell[]) {
  return cells.flatMap((cell) =>
    cell.kind === "meter" ? [[cell.label, cell.window, cell.used] as const] : [],
  );
}

describe("claude", () => {
  const conn = connection("claude", {
    metrics: [
      percent("limits.Fable", 91, { resetsAt: reset }),
      percent("seven_day", 78, { resetsAt: reset }),
      percent("five_hour", 49, { scope: "window:18000s", resetsAt: reset + 1 }),
      metric("reset_grants.available", {
        kind: "reset_inventory",
        unit: "resets",
        scope: "account",
        valueText: "0",
        valueNum: 0,
      }),
    ],
  });
  const panel = presentPanel(conn);
  test("a session window with no reset time has not started", () => {
    const idle = presentPanel(
      connection("claude", {
        metrics: [
          percent("five_hour", 0, { scope: "window:18000s", resetsAt: null }),
          percent("seven_day", 9, { resetsAt: null }),
        ],
      }),
    );
    const words = idle.cells.map((cell) => (cell.kind === "meter" ? cell.resetWords : null));
    expect(words).toEqual(["not_started", "resets"]);
  });
  test("cells follow the approved panel", () => {
    expect(meters(panel.cells)).toEqual([
      ["Session", "5 hours", 49],
      ["Weekly", "all models", 78],
      ["Weekly", "Fable", 91],
    ]);
    expect(panel.facts).toEqual([]);
    expect(panel.cells.some((cell) => cell.kind === "resets")).toBe(false);
    expect(panel.banked).toEqual({ count: 0, label: "Reset Grant", expiries: [] });
    expect(panel.hold).toBeNull();
  });
  test("banked grants list every usable expiry, soonest first, with no hold", () => {
    const late = new Date(2025, 9, 20).getTime();
    const soon = new Date(2025, 9, 5).getTime();
    const banked = presentPanel(
      connection("claude", {
        metrics: [
          metric("reset_grants.available", {
            kind: "reset_inventory",
            unit: "resets",
            scope: "account",
            valueText: "2",
            valueNum: 2,
          }),
        ],
        resetCredits: [
          credit("grant-0", { expiresAt: late }),
          credit("grant-1", { expiresAt: soon }),
          credit("grant-2", { usable: false, expiresAt: 1 }),
        ],
        actions: { enabled: true, supported: [] },
      }),
    );
    expect(banked.banked).toEqual({ count: 2, label: "Reset Grant", expiries: [soon, late] });
    expect(banked.hold).toBeNull();
  });
  test("an ineligible account shows no banked summary", () => {
    const none = presentPanel(connection("claude", { metrics: [percent("seven_day", 5)] }));
    expect(none.banked).toBeNull();
  });
  test("the table shows the weekly all-models limit, not the highest", () => {
    expect(panel.tightest).toEqual({
      label: "Weekly",
      used: 78,
      resetsAt: reset,
      resetWords: "resets",
    });
  });
  test("a scoped Sonnet limit replaces the older Sonnet bucket", () => {
    const both = presentPanel(
      connection("claude", {
        metrics: [percent("seven_day_sonnet", 10), percent("limits.Sonnet", 12)],
      }),
    );
    expect(meters(both.cells)).toEqual([["Weekly", "Sonnet", 12]]);
    const only = presentPanel(connection("claude", { metrics: [percent("seven_day_sonnet", 10)] }));
    expect(meters(only.cells)).toEqual([["Weekly", "Sonnet", 10]]);
  });
  test("extra usage shows spend, and the cap only when present", () => {
    const usd = { kind: "spend", unit: "USD", scope: "month" } as const;
    const withCap = presentPanel(
      connection("claude", {
        metrics: [
          metric("extra_usage.used", { ...usd, valueText: "12.50", valueNum: 12.5 }),
          metric("extra_usage.monthly_limit", {
            ...usd,
            kind: "spending_cap",
            valueText: "1000.00",
            valueNum: 1000,
          }),
        ],
      }),
    );
    expect(withCap.facts).toEqual([
      { key: "extra_usage.used", label: "Extra Usage Spend", value: "$12.50 of $1,000.00" },
    ]);
    const noCap = presentPanel(
      connection("claude", {
        metrics: [metric("extra_usage.used", { ...usd, valueText: "12.5", valueNum: 12.5 })],
      }),
    );
    expect(noCap.facts[0]?.value).toBe("$12.50");
  });
  test("a missing bucket is absent, an unknown one is a cell without a number", () => {
    const unknown = presentPanel(
      connection("claude", {
        metrics: [metric("seven_day", { availability: "unknown" }), percent("five_hour", 5)],
      }),
    );
    expect(meters(unknown.cells)).toEqual([
      ["Session", "5 hours", 5],
      ["Weekly", "all models", null],
    ]);
    expect(unknown.tightest?.label).toBe("Session");
  });
});

describe("codex", () => {
  const expiries = [
    new Date(2025, 9, 22, 14, 39).getTime(),
    new Date(2025, 9, 5, 6, 25).getTime(),
    new Date(2025, 9, 29, 13, 0).getTime(),
  ];
  const conn = connection("codex", {
    metrics: [
      percent("rate_limit.primary_window", 23, { scope: "window:604800s", resetsAt: reset }),
      metric("credits.balance", {
        kind: "credits",
        unit: "codex_credits",
        scope: "account",
        valueText: "61068",
        valueNum: 61068,
      }),
      metric("reset_credits.available_count", {
        kind: "reset_inventory",
        unit: "resets",
        scope: "account",
        valueText: "3",
        valueNum: 3,
      }),
    ],
    resetCredits: [
      credit("c-b", { expiresAt: expiries[0] ?? null }),
      credit("c-a", { expiresAt: expiries[1] ?? null }),
      credit("c-c", { expiresAt: expiries[2] ?? null }),
      credit("c-used", { usable: false, eligible: false, expiresAt: 1 }),
    ],
    actions: { enabled: true, supported: ["consume_reset_credit"] },
  });
  const panel = presentPanel(conn);
  test("weekly meter, credits balance, banked resets", () => {
    expect(panel.cells).toEqual([
      expect.objectContaining({ kind: "meter", label: "Weekly", window: "7 days", used: 23 }),
      expect.objectContaining({
        kind: "amount",
        label: "Credits",
        value: 61068,
        unit: "credits",
        note: null,
        unlimited: false,
      }),
      {
        kind: "resets",
        key: "reset_credits.available_count",
        label: "Reset Credits",
        window: "banked",
        count: 3,
        expiries: [expiries[1], expiries[0], expiries[2]],
      },
    ]);
  });
  test("hold is the soonest usable credit", () => {
    expect(panel.hold).toEqual({ creditId: "c-a", expiresAt: expiries[1] ?? null });
  });
  test("hold skips a credit that has already expired", () => {
    const afterFirst = new Date(2025, 9, 6).getTime();
    expect(presentPanel(conn, afterFirst).hold?.expiresAt).toBe(expiries[0] ?? null);
  });
  test("no hold unless the connection supports the action", () => {
    expect(presentPanel({ ...conn, actions: { enabled: true, supported: [] } }).hold).toBeNull();
  });
  test("windows are labelled by their length, shortest first", () => {
    const two = presentPanel(
      connection("codex", {
        metrics: [
          percent("rate_limit.primary_window", 40, { scope: "window:604800s" }),
          percent("rate_limit.secondary_window", 60, { scope: "window:18000s" }),
          percent("additional.Spark.primary_window", 5, { scope: "window:604800s" }),
          percent("additional.Spark.secondary_window", 1, { scope: "window:86400s" }),
        ],
      }),
    );
    expect(meters(two.cells)).toEqual([
      ["Session", "5 hours", 60],
      ["Weekly", "7 days", 40],
      ["Daily", "Spark", 1],
      ["Weekly", "Spark", 5],
    ]);
    expect(two.tightest?.label).toBe("Session");
  });
  test("unlimited credits are not a number", () => {
    const unlimited = presentPanel(
      connection("codex", {
        metrics: [
          metric("credits.balance", {
            kind: "credits",
            unit: "codex_credits",
            scope: "account",
            unlimited: true,
          }),
        ],
      }),
    );
    expect(unlimited.cells[0]).toEqual(
      expect.objectContaining({ kind: "amount", value: null, unlimited: true }),
    );
    expect(unlimited.balance).toBeNull();
  });
  test("a balance with no meters is the account balance", () => {
    const only = presentPanel(
      connection("codex", {
        metrics: [
          metric("credits.balance", {
            kind: "credits",
            unit: "codex_credits",
            scope: "account",
            valueText: "12.5",
            valueNum: 12.5,
          }),
        ],
      }),
    );
    expect(only.balance).toEqual({ label: "Credits", value: 12.5, unit: "credits" });
    expect(only.tightest).toBeNull();
  });
});

describe("cursor", () => {
  const cycleStart = new Date(2025, 8, 26, 10).getTime();
  const cycleEnd = new Date(2025, 9, 26, 10).getTime();
  const cycle = {
    scope: "billing_cycle",
    windowStart: cycleStart,
    windowEnd: cycleEnd,
    resetsAt: cycleEnd,
  };
  const usd = { kind: "spend", unit: "USD", scope: "on_demand:user" } as const;
  const panel = presentPanel(
    connection("cursor", {
      metrics: [
        percent("included.api_percent", 6.48, cycle),
        percent("included.auto_percent", 90, cycle),
        percent("included.total_percent", 17.02, cycle),
        metric("included.limit", {
          kind: "spending_cap",
          unit: "USD",
          scope: "billing_cycle",
          valueText: "20.00",
          valueNum: 20,
        }),
        metric("on_demand.used", { ...usd, valueText: "0.00", valueNum: 0 }),
        metric("on_demand.limit", {
          ...usd,
          kind: "spending_cap",
          valueText: "50.00",
          valueNum: 50,
        }),
      ],
    }),
  );
  test("pools stay separate meters", () => {
    expect(meters(panel.cells)).toEqual([
      ["Included", "$20 plan", 17.02],
      ["Auto Pool", "billing cycle", 90],
      ["API Pool", "billing cycle", 6.48],
    ]);
  });
  test("captions: the cycle end on Included, no time on the pools", () => {
    const words = panel.cells.flatMap((cell) => (cell.kind === "meter" ? [cell.resetWords] : []));
    expect(words).toEqual(["cycle_end", "with_cycle", "with_cycle"]);
  });
  test("facts show spend, its cap and the cycle", () => {
    expect(panel.facts).toEqual([
      { key: "on_demand.used", label: "On-Demand Spend", value: "$0.00 of $50.00" },
      { key: "cycle", label: "Cycle", value: "Sep 26 to Oct 26" },
    ]);
  });
  test("the table shows included usage even when a pool is higher", () => {
    expect(panel.tightest).toEqual({
      label: "Included Usage",
      used: 17.02,
      resetsAt: cycleEnd,
      resetWords: "cycle_end",
    });
  });
  test("Grok Bot is its own weekly meter after the pools, and never the account's headline", () => {
    const weekEnd = cycleStart + 5 * 24 * 3_600_000;
    const withBot = presentPanel(
      connection("cursor", {
        metrics: [
          percent("included.total_percent", 17.02, cycle),
          percent("grok_bot.used_percent", 88, {
            scope: "window:604800s",
            windowStart: weekEnd - 7 * 24 * 3_600_000,
            windowEnd: weekEnd,
            resetsAt: weekEnd,
          }),
        ],
      }),
    );
    expect(meters(withBot.cells)).toEqual([
      ["Included", "billing cycle", 17.02],
      ["Grok Bot", "weekly", 88],
    ]);
    const bot = withBot.cells.find((cell) => cell.key === "grok_bot.used_percent");
    expect(bot).toMatchObject({ resetsAt: weekEnd, resetWords: "resets" });
    expect(withBot.tightest?.label).toBe("Included Usage");
  });
});

describe("grok", () => {
  const credits = { unit: "grok_credits", scope: "account" } as const;
  test("pool, product shares, cap off and prepaid", () => {
    const panel = presentPanel(
      connection("grok", {
        metrics: [
          percent("weekly_pool.used_percent", 0, { scope: "window:weekly" }),
          percent("product.grok_code.used_percent", 12, { scope: "window:weekly" }),
          percent("product.grok_chat.used_percent", 3, { scope: "window:weekly" }),
          metric("on_demand_cap", {
            ...credits,
            kind: "spending_cap",
            valueText: "0",
            valueNum: 0,
          }),
          metric("prepaid_balance", { ...credits, kind: "credits", valueText: "0", valueNum: 0 }),
        ],
      }),
    );
    expect(meters(panel.cells)).toEqual([
      ["Weekly Pool", "7 days", 0],
      ["Chat", "share of pool", 3],
      ["Code", "share of pool", 12],
    ]);
    expect(panel.facts).toEqual([
      { key: "on_demand_cap", label: "On-Demand", value: "Off" },
      { key: "prepaid_balance", label: "Prepaid Balance", value: "0 credits" },
    ]);
    expect(panel.tightest?.label).toBe("Weekly Pool");
  });
  test("an enabled cap shows used of cap", () => {
    const panel = presentPanel(
      connection("grok", {
        metrics: [
          metric("on_demand_cap", {
            ...credits,
            kind: "spending_cap",
            valueText: "5000",
            valueNum: 5000,
          }),
          metric("on_demand.used", { ...credits, kind: "spend", valueText: "120", valueNum: 120 }),
        ],
      }),
    );
    expect(panel.facts).toEqual([
      { key: "on_demand_cap", label: "On-Demand", value: "120 of 5,000 credits" },
    ]);
  });
  test("a pool the account may not read is left out", () => {
    const panel = presentPanel(
      connection("grok", {
        metrics: [metric("weekly_pool.used_percent", { availability: "not_authorized" })],
      }),
    );
    expect(panel.cells).toEqual([]);
  });
});

describe("antigravity", () => {
  test("Gemini and Claude and GPT, only the windows reported", () => {
    const panel = presentPanel(
      connection("antigravity", {
        metrics: [
          percent("quota.3p-weekly", 25, { scope: "window:604800s" }),
          percent("quota.gemini-weekly", 0, { scope: "window:604800s" }),
        ],
      }),
    );
    expect(meters(panel.cells)).toEqual([
      ["Gemini", "weekly", 0],
      ["Claude and GPT", "weekly", 25],
    ]);
    expect(panel.tightest).toEqual({
      label: "Claude and GPT Weekly",
      used: 25,
      resetsAt: null,
      resetWords: "resets",
    });
  });
});

describe("copilot", () => {
  const month = { scope: "month" } as const;
  test("unlimited credits and request facts", () => {
    const panel = presentPanel(
      connection("copilot", {
        metrics: [
          metric("credits.used_percent", { ...month, unlimited: true }),
          metric("credits.used_count", {
            ...month,
            kind: "absolute_quota",
            unit: "credits",
            valueText: "1",
            valueNum: 1,
          }),
          metric("extra_usage.count", {
            ...month,
            kind: "absolute_quota",
            unit: "credits",
            valueText: "0",
            valueNum: 0,
          }),
          metric("chat.used", {
            ...month,
            kind: "absolute_quota",
            unit: "requests",
            unlimited: true,
          }),
          metric("completions.used", {
            ...month,
            kind: "absolute_quota",
            unit: "requests",
            valueText: "12",
            valueNum: 12,
          }),
        ],
      }),
    );
    expect(panel.cells).toEqual([
      expect.objectContaining({ kind: "meter", label: "AI Credits", used: null, unlimited: true }),
    ]);
    expect(panel.facts.map((f) => [f.label, f.value])).toEqual([
      ["Credits Used", "1"],
      ["Extra Usage", "0 credits"],
      ["Chat", "Unlimited"],
      ["Completions", "12 requests"],
    ]);
    expect(panel.tightest).toBeNull();
  });
  test("small usage keeps a decimal so it does not read as zero", () => {
    const panel = presentPanel(
      connection("copilot", { metrics: [percent("credits.used_percent", 0.8, month)] }),
    );
    expect(panel.cells[0]).toEqual(expect.objectContaining({ used: 0.8, decimals: 1 }));
  });
  test("a seat with no pool shows no meter", () => {
    const panel = presentPanel(
      connection("copilot", {
        metrics: [metric("credits.used_percent", { ...month, availability: "unsupported" })],
      }),
    );
    expect(panel.cells).toEqual([]);
  });
});

describe("vercel", () => {
  const gateway = { kind: "credits", unit: "gateway_credits", scope: "team" } as const;
  const base = [
    metric("credits.balance", { ...gateway, valueText: "4.99", valueNum: 4.99 }),
    metric("credits.total_used", { ...gateway, valueText: "0.01", valueNum: 0.01 }),
  ];
  test("balance against a total, and credits used", () => {
    const panel = presentPanel(connection("vercel_ai_gateway", { metrics: base }));
    expect(panel.cells).toEqual([
      {
        kind: "amount",
        key: "credits.balance",
        label: "Credit Balance",
        window: null,
        value: 4.99,
        unlimited: false,
        unit: "credits",
        decimals: 2,
        of: "5.00",
        note: "0.01 used of 5.00",
      },
      {
        kind: "amount",
        key: "credits.total_used",
        label: "Credits Used",
        window: "lifetime",
        value: 0.01,
        unlimited: false,
        unit: "credits",
        decimals: 2,
        of: null,
        note: "On this gateway key",
      },
    ]);
    expect(panel.balance).toEqual({ label: "Credit Balance", value: 4.99, unit: "credits" });
  });
  test("spend is hidden when not authorized and unknown when it may still arrive", () => {
    const spend = { kind: "spend", unit: "USD", scope: "team" } as const;
    const hidden = presentPanel(
      connection("vercel_ai_gateway", {
        metrics: [...base, metric("spend.30d", { ...spend, availability: "not_authorized" })],
      }),
    );
    expect(hidden.cells).toHaveLength(2);
    const later = presentPanel(
      connection("vercel_ai_gateway", {
        metrics: [
          ...base,
          metric("spend.30d", { ...spend, availability: "temporarily_unavailable" }),
        ],
      }),
    );
    expect(later.cells[2]).toEqual(
      expect.objectContaining({ label: "Spend", window: "30 days", unit: "usd", value: null }),
    );
  });
});

describe("general", () => {
  test("no snapshot gives an empty panel", () => {
    const panel = presentPanel({ ...connection("claude"), snapshot: null });
    expect(panel).toEqual({
      cells: [],
      facts: [],
      banked: null,
      hold: null,
      tightest: null,
      balance: null,
    });
  });
  test("keys no rule knows still show", () => {
    const panel = presentPanel(
      connection("cursor", {
        metrics: [
          percent("future.bucket", 40, { scope: "window:18000s" }),
          metric("future.count", {
            kind: "absolute_quota",
            unit: "requests",
            valueText: "7",
            valueNum: 7,
          }),
        ],
      }),
    );
    expect(meters(panel.cells)).toEqual([["Future Bucket", "5 hours", 40]]);
    expect(panel.facts).toEqual([{ key: "future.count", label: "Future Count", value: "7" }]);
  });
  test("number formats", () => {
    expect(formatNumber(61068, 0)).toBe("61,068");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});
