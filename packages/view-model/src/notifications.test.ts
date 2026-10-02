import { describe, expect, test } from "bun:test";

import { notificationEventSchema } from "@headroom/core/contracts";

import {
  currentIds,
  deriveNotifications,
  type NotificationSettings,
  loadRead,
  markAllRead,
  markRead,
  pruneRead,
  readKey,
  saveRead,
} from "./notifications.ts";
import type { Metric } from "./overview.ts";
import { connection, credit, metric, percent } from "./test-fixtures.ts";

const defaultSettings: NotificationSettings = {
  limitsView: "used",
  lowThresholdPercent: 30,
  timeStyle: "countdown",
  clock: "24h",
  notifications: {
    runningLow: true,
    expiringResets: true,
    refreshFailures: true,
    balances: true,
    spend: true,
    includeSessions: true,
    resetLeadDays: 3,
    mutedProviders: [],
  },
};

const now = new Date(2025, 9, 2, 14, 14).getTime();
const reset = new Date(2025, 9, 2, 15, 6).getTime();

const claude = connection("claude", {
  id: "c1",
  observedAt: now - 720_000,
  metrics: [
    percent("seven_day", 78, { resetsAt: reset }),
    percent("limits.Fable", 91, { resetsAt: reset }),
    percent("five_hour", 20, { scope: "window:18000s", resetsAt: reset }),
  ],
});

describe("limit notifications", () => {
  const found = deriveNotifications([claude], defaultSettings, now);
  test("wording follows the approved mockup, worst first", () => {
    expect(found.map((n) => [n.tone, n.title, n.message])).toEqual([
      ["bad", "Claude Is Almost Out of Its Weekly Fable Limit", "91% used. Resets in 52 min."],
      ["warn", "Claude Weekly Limit Is Running Low", "78% used. Resets in 52 min."],
    ]);
    expect(found[0]?.kind).toBe("almost_out");
    expect(found[1]?.occurredAt).toBe(now - 720_000);
  });
  test("ids carry the connection, kind, metric and reset instant", () => {
    expect(found[1]?.id).toBe(`c1:running_low:seven_day:${reset}`);
    const next = deriveNotifications(
      [
        connection("claude", {
          id: "c1",
          metrics: [percent("seven_day", 78, { resetsAt: reset + 7 * 86_400_000 })],
        }),
      ],
      defaultSettings,
      now,
    );
    expect(next[0]?.id).not.toBe(found[1]?.id);
  });
  test("a lower threshold hides the amber one", () => {
    const strict = { ...defaultSettings, lowThresholdPercent: 15 } as const;
    expect(deriveNotifications([claude], strict, now).map((n) => n.kind)).toEqual(["almost_out"]);
  });
  test("left view and exact time", () => {
    const style = { ...defaultSettings, limitsView: "left", timeStyle: "exact" } as const;
    expect(deriveNotifications([claude], style, now)[1]?.message).toBe(
      "22% left. Resets at 15:06.",
    );
  });
  test("running low can be switched off, the other kinds stay", () => {
    const off = {
      ...defaultSettings,
      notifications: { ...defaultSettings.notifications, runningLow: false },
    };
    expect(deriveNotifications([claude], off, now)).toEqual([]);
    expect(currentIds([claude], off, now).size).toBe(2);
  });
  test("unlimited, unknown and paused accounts stay quiet", () => {
    const quiet = [
      connection("copilot", {
        metrics: [percent("credits.used_percent", 0, { unlimited: true })],
      }),
      connection("claude", { metrics: [percent("seven_day", 99)], state: "paused" }),
    ];
    expect(deriveNotifications(quiet, defaultSettings, now)).toEqual([]);
  });
});

describe("expiring resets", () => {
  const expires = new Date(2025, 9, 5, 6, 25).getTime();
  const codex = connection("codex", {
    id: "x1",
    resetCredits: [
      credit("a", { expiresAt: expires }),
      credit("b", { expiresAt: new Date(2025, 9, 22).getTime() }),
      credit("c", { expiresAt: new Date(2025, 9, 29).getTime() }),
      credit("gone", { usable: false, expiresAt: expires }),
    ],
  });
  test("one notice for the soonest, counting the bank", () => {
    const [item] = deriveNotifications([codex], defaultSettings, now);
    expect(item).toEqual(
      expect.objectContaining({
        tone: "info",
        kind: "reset_expiring",
        title: "A Codex Reset Expires in 3 Days",
        message: "1 of 3 banked full resets expires Oct 5.",
        id: `x1:reset_expiring:a:${expires}`,
      }),
    );
  });
  test("Claude grants raise the same notice", () => {
    const banked = connection("claude", {
      id: "c1",
      resetCredits: [
        credit("grant-0", { expiresAt: expires }),
        credit("grant-1", { usable: false, expiresAt: expires }),
      ],
    });
    const [item] = deriveNotifications([banked], defaultSettings, now);
    expect(item?.title).toBe("A Claude Reset Expires in 3 Days");
    expect(item?.message).toBe("1 of 1 banked full resets expires Oct 5.");
  });
  test("several soon", () => {
    const two = connection("codex", {
      resetCredits: [
        credit("a", { expiresAt: expires }),
        credit("b", { expiresAt: expires + 3_600_000 }),
      ],
    });
    expect(deriveNotifications([two], defaultSettings, now)[0]?.message).toBe(
      "2 of 2 banked full resets expire from Oct 5.",
    );
  });
  test("under a day reads 1 Day; beyond three days is quiet; the switch works", () => {
    const tomorrow = connection("claude", {
      resetCredits: [credit("a", { expiresAt: now + 3_600_000 })],
    });
    expect(deriveNotifications([tomorrow], defaultSettings, now)[0]?.title).toBe(
      "A Claude Reset Expires in 1 Day",
    );
    const far = connection("codex", {
      resetCredits: [credit("a", { expiresAt: now + 4 * 86_400_000 })],
    });
    expect(deriveNotifications([far], defaultSettings, now)).toEqual([]);
    const off = {
      ...defaultSettings,
      notifications: { ...defaultSettings.notifications, expiringResets: false },
    };
    expect(deriveNotifications([codex], off, now)).toEqual([]);
  });
});

const run = (startedAt: number) => ({
  startedAt,
  finishedAt: startedAt + 10,
  outcome: "provider_unavailable" as const,
  error: "down",
});

describe("failures", () => {
  test("a disconnected account", () => {
    const conn = connection("copilot", {
      id: "p1",
      state: "reconnect_required",
      reconnectReason: "token_rejected",
      lastSuccessAt: 7_000,
    });
    const [item] = deriveNotifications([conn], defaultSettings, now);
    expect(item).toEqual(
      expect.objectContaining({
        tone: "bad",
        title: "Copilot Is Disconnected",
        id: "p1:disconnected:token_rejected:7000",
      }),
    );
  });
  test("a failed refresh keeps one id until the next success", () => {
    const first = deriveNotifications(
      [connection("grok", { latestRun: run(100) })],
      defaultSettings,
      now,
    );
    const second = deriveNotifications(
      [connection("grok", { latestRun: run(900) })],
      defaultSettings,
      now,
    );
    expect(first[0]?.title).toBe("Grok Refresh Failed");
    expect(first[0]?.tone).toBe("warn");
    expect(second[0]?.id).toBe(first[0]?.id ?? "");
    const recovered = deriveNotifications(
      [connection("grok", { latestRun: run(900), lastSuccessAt: 99_999 })],
      defaultSettings,
      now,
    );
    expect(recovered[0]?.id).not.toBe(first[0]?.id);
  });
  test("a run still in progress, a partial run and a disabled switch are quiet", () => {
    const inProgress = connection("grok", {
      latestRun: { startedAt: 1, finishedAt: null, outcome: null, error: null },
    });
    const partial = connection("grok", {
      latestRun: { startedAt: 1, finishedAt: 2, outcome: "partial", error: null },
    });
    expect(deriveNotifications([inProgress, partial], defaultSettings, now)).toEqual([]);
    const off = {
      ...defaultSettings,
      notifications: { ...defaultSettings.notifications, refreshFailures: false },
    };
    const bad = connection("grok", { state: "reconnect_required" });
    expect(deriveNotifications([bad], off, now)).toEqual([]);
  });
});

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

describe("read state", () => {
  test("round trip through storage", () => {
    const store = memory();
    saveRead(store, new Set(["b", "a"]));
    expect(store.data.get(readKey)).toBe('["a","b"]');
    expect([...loadRead(store)]).toEqual(["a", "b"]);
  });
  test("bad stored data reads as empty", () => {
    const store = memory();
    store.data.set(readKey, "{nope");
    expect(loadRead(store).size).toBe(0);
    store.data.set(readKey, '[1,"x",null]');
    expect([...loadRead(store)]).toEqual(["x"]);
  });
  test("mark one, mark all, prune", () => {
    const one = markRead(new Set(), "a");
    expect([...one]).toEqual(["a"]);
    expect([...markAllRead(one, [{ id: "b" }, { id: "c" }])].toSorted()).toEqual(["a", "b", "c"]);
    expect([...pruneRead(new Set(["a", "b"]), new Set(["b", "z"]))]).toEqual(["b"]);
  });
});

type Preferences = typeof defaultSettings.notifications;

const withNotifications = (
  over: Partial<Preferences>,
  rest: Partial<typeof defaultSettings> = {},
) => ({
  ...defaultSettings,
  ...rest,
  notifications: { ...defaultSettings.notifications, ...over },
});

const kindsOf = (items: readonly { kind: string }[]) => items.map((item) => item.kind);

const gateway = (balance: number, used: number | null, id = "v1") =>
  connection("vercel_ai_gateway", {
    id,
    metrics: [
      metric("credits.balance", {
        kind: "credits",
        unit: "gateway_credits",
        scope: "team",
        valueNum: balance,
        valueText: String(balance),
      }),
      ...(used === null
        ? []
        : [
            metric("credits.total_used", {
              kind: "credits",
              unit: "gateway_credits",
              scope: "team",
              valueNum: used,
              valueText: String(used),
            }),
          ]),
    ],
  });

describe("balance_low", () => {
  test("warns under the threshold and goes bad under 10% left, in credits not dollars", () => {
    const [warn] = deriveNotifications([gateway(2, 8)], defaultSettings, now);
    expect(warn).toEqual(
      expect.objectContaining({
        kind: "balance_low",
        tone: "warn",
        title: "Vercel AI Gateway Credits Are Running Low",
        message: "80% used. 2.00 of 10.00 credits remain.",
        figures: {
          percentUsed: 80,
          percentLeft: 20,
          amount: { value: 2, unit: "gateway_credits" },
          cap: { value: 10, unit: "gateway_credits" },
        },
      }),
    );
    expect(warn?.message).not.toContain("$");
    const [bad] = deriveNotifications([gateway(0.5, 9.5)], defaultSettings, now);
    expect(bad).toEqual(
      expect.objectContaining({ tone: "bad", title: "Vercel AI Gateway Credits Are Almost Out" }),
    );
  });
  test("plenty left, an unknown total, and a zero with no total stay quiet", () => {
    expect(deriveNotifications([gateway(8, 2)], defaultSettings, now)).toEqual([]);
    expect(deriveNotifications([gateway(1, null)], defaultSettings, now)).toEqual([]);
    expect(deriveNotifications([gateway(0, 0)], defaultSettings, now)).toEqual([]);
    expect(deriveNotifications([gateway(0, 5)], defaultSettings, now)[0]?.tone).toBe("bad");
  });
  test("Codex credits and Grok prepaid balances never notify", () => {
    const codex = connection("codex", {
      metrics: [
        metric("credits.balance", {
          kind: "credits",
          scope: "account",
          valueNum: 0,
          valueText: "0",
        }),
      ],
    });
    const grok = connection("grok", {
      metrics: [metric("prepaid_balance", { kind: "credits", valueNum: 0, valueText: "0" })],
    });
    expect(deriveNotifications([codex, grok], defaultSettings, now)).toEqual([]);
  });
  test("a top-up starts a new notice; the switch and inactive accounts silence it", () => {
    const first = deriveNotifications([gateway(2, 8)], defaultSettings, now)[0];
    const topped = deriveNotifications([gateway(2, 18)], defaultSettings, now)[0];
    expect(topped?.id).not.toBe(first?.id);
    const off = withNotifications({ balances: false });
    expect(deriveNotifications([gateway(2, 8)], off, now)).toEqual([]);
    const paused = { ...gateway(2, 8), state: "paused" } as const;
    expect(deriveNotifications([paused], defaultSettings, now)).toEqual([]);
  });
});

const usd = (key: string, value: number, over: Partial<Metric> = {}) =>
  metric(key, {
    kind: key.endsWith("limit") ? "spending_cap" : "spend",
    unit: "USD",
    scope: "month",
    valueNum: value,
    valueText: String(value),
    ...over,
  });

const claudeSpend = (used: number, cap: number | null) =>
  connection("claude", {
    id: "c2",
    metrics: [
      usd("extra_usage.used", used),
      ...(cap === null ? [] : [usd("extra_usage.monthly_limit", cap)]),
    ],
  });

const cursorPair = (limitScope: string) =>
  connection("cursor", {
    metrics: [
      usd("on_demand.used", 45, { scope: "on_demand:user" }),
      usd("on_demand.limit", 50, { scope: limitScope }),
    ],
  });

const grokSpend = (used: number, cap: number) =>
  connection("grok", {
    metrics: [
      metric("on_demand.used", {
        kind: "spend",
        unit: "grok_credits",
        scope: "window:weekly",
        valueNum: used,
        valueText: String(used),
      }),
      metric("on_demand_cap", {
        kind: "spending_cap",
        unit: "grok_credits",
        scope: "account",
        valueNum: cap,
        valueText: String(cap),
      }),
    ],
  });

describe("spend notices", () => {
  test("Claude: warns from 70% on the default threshold, reached at 100%, in dollars", () => {
    expect(deriveNotifications([claudeSpend(34, 50)], defaultSettings, now)).toEqual([]);
    const [near] = deriveNotifications([claudeSpend(35, 50)], defaultSettings, now);
    expect(near).toEqual(
      expect.objectContaining({
        kind: "spend_near_cap",
        tone: "warn",
        title: "Claude Extra Usage Is Near Its Cap",
        message: "$35.00 of $50.00 spent.",
      }),
    );
    expect(near?.figures.amount).toEqual({ value: 35, unit: "USD" });
    expect(near?.figures.cap).toEqual({ value: 50, unit: "USD" });
    const [reached] = deriveNotifications([claudeSpend(50, 50)], defaultSettings, now);
    expect(reached).toEqual(
      expect.objectContaining({
        kind: "spend_cap_reached",
        tone: "bad",
        title: "Claude Extra Usage Has Reached Its Cap",
      }),
    );
  });
  test("the threshold setting moves the line", () => {
    const strict = { ...defaultSettings, lowThresholdPercent: 15 } as const;
    expect(deriveNotifications([claudeSpend(35, 50)], strict, now)).toEqual([]);
    expect(deriveNotifications([claudeSpend(43, 50)], strict, now)[0]?.kind).toBe("spend_near_cap");
  });
  test("Claude without a cap, or with unknown spend, is quiet", () => {
    expect(deriveNotifications([claudeSpend(500, null)], defaultSettings, now)).toEqual([]);
    const unknown = connection("claude", {
      metrics: [
        usd("extra_usage.used", 0, { valueNum: null, valueText: null, availability: "unknown" }),
        usd("extra_usage.monthly_limit", 50),
      ],
    });
    expect(deriveNotifications([unknown], defaultSettings, now)).toEqual([]);
  });
  test("a new month gets a new id", () => {
    const first = deriveNotifications([claudeSpend(40, 50)], defaultSettings, now)[0];
    const later = connection("claude", {
      id: "c2",
      observedAt: now + 40 * 86_400_000,
      metrics: [usd("extra_usage.used", 40), usd("extra_usage.monthly_limit", 50)],
    });
    expect(deriveNotifications([later], defaultSettings, now)[0]?.id).not.toBe(first?.id);
  });
  test("Cursor pairs spend and limit of the same scope only", () => {
    const [item] = deriveNotifications([cursorPair("on_demand:user")], defaultSettings, now);
    expect(item?.title).toBe("Cursor On-Demand Spend Is Near Its Cap");
    expect(deriveNotifications([cursorPair("on_demand:pooled")], defaultSettings, now)).toEqual([]);
  });
  test("Grok counts credits, never dollars, and a cap of 0 is off", () => {
    const [item] = deriveNotifications([grokSpend(900, 1000)], defaultSettings, now);
    expect(item?.message).toBe("900 of 1,000 credits used.");
    expect(item?.figures.amount).toEqual({ value: 900, unit: "grok_credits" });
    expect(item?.message).not.toContain("$");
    expect(deriveNotifications([grokSpend(900, 0)], defaultSettings, now)).toEqual([]);
  });
  test("the switch and inactive accounts silence spend", () => {
    const off = withNotifications({ spend: false });
    expect(deriveNotifications([claudeSpend(50, 50)], off, now)).toEqual([]);
    const gone = { ...claudeSpend(50, 50), state: "reconnect_required" } as const;
    expect(kindsOf(deriveNotifications([gone], defaultSettings, now))).toEqual(["disconnected"]);
  });
});

const copilotExtra = (count: number | null, resetsAt = now + 86_400_000) =>
  connection("copilot", {
    id: "p2",
    metrics: [
      percent("credits.used_percent", 10, { scope: "month", resetsAt }),
      metric("extra_usage.count", {
        kind: "absolute_quota",
        unit: "credits",
        scope: "month",
        valueNum: count,
        valueText: count === null ? null : String(count),
        availability: count === null ? "unknown" : "available",
      }),
    ],
  });

describe("extra_usage_started", () => {
  test("fires once extra usage is above zero, with an id per period", () => {
    const [item] = deriveNotifications([copilotExtra(3)], defaultSettings, now);
    expect(item).toEqual(
      expect.objectContaining({
        kind: "extra_usage_started",
        tone: "info",
        title: "Copilot Has Started Extra Usage",
        message: "3 extra credits used this month.",
        id: `p2:extra_usage_started:extra_usage.count:${now + 86_400_000}`,
      }),
    );
    expect(item?.figures.amount).toEqual({ value: 3, unit: "credits" });
    const next = deriveNotifications(
      [copilotExtra(3, now + 40 * 86_400_000)],
      defaultSettings,
      now,
    );
    expect(next[0]?.id).not.toBe(item?.id);
  });
  test("zero and unknown are quiet; the spend switch silences it", () => {
    expect(deriveNotifications([copilotExtra(0)], defaultSettings, now)).toEqual([]);
    expect(deriveNotifications([copilotExtra(null)], defaultSettings, now)).toEqual([]);
    const off = withNotifications({ spend: false });
    expect(deriveNotifications([copilotExtra(3)], off, now)).toEqual([]);
  });
});

const busyClaude = connection("claude", {
  id: "m1",
  metrics: [
    percent("seven_day", 95, { resetsAt: reset }),
    percent("five_hour", 95, { scope: "window:18000s", resetsAt: reset }),
  ],
  resetCredits: [credit("g", { expiresAt: now + 3_600_000 })],
});
const busy = [
  busyClaude,
  connection("grok", { id: "m2", latestRun: run(100) }),
  connection("codex", {
    id: "m3",
    state: "reconnect_required",
    reconnectReason: "refresh_rejected",
  }),
];

const sessionKeys = (settings: typeof defaultSettings) =>
  deriveNotifications([busyClaude], settings, now)
    .filter((item) => item.kind !== "reset_expiring")
    .map((item) => item.subject.metricKey ?? "")
    .toSorted((a, b) => a.localeCompare(b));

const resetIn = (days: number) =>
  connection("codex", {
    resetCredits: [credit("a", { expiresAt: now + days * 86_400_000 - 1000 })],
  });

describe("muting, sessions and lead days", () => {
  test("a muted provider is silent except for a broken sign-in", () => {
    const muted = withNotifications({ mutedProviders: ["claude", "grok", "codex"] });
    expect(kindsOf(deriveNotifications(busy, muted, now))).toEqual(["disconnected"]);
    const some = withNotifications({ mutedProviders: ["claude"] });
    expect(kindsOf(deriveNotifications(busy, some, now)).toSorted()).toEqual([
      "disconnected",
      "refresh_failed",
    ]);
  });
  test("includeSessions off skips 5-hour windows only", () => {
    expect(sessionKeys(defaultSettings)).toEqual(["five_hour", "seven_day"]);
    expect(sessionKeys(withNotifications({ includeSessions: false }))).toEqual(["seven_day"]);
  });
  test("the reset lead decides how early a reset shows", () => {
    expect(deriveNotifications([resetIn(2)], withNotifications({ resetLeadDays: 1 }), now)).toEqual(
      [],
    );
    expect(
      deriveNotifications([resetIn(1)], withNotifications({ resetLeadDays: 1 }), now),
    ).toHaveLength(1);
    expect(deriveNotifications([resetIn(5)], withNotifications({ resetLeadDays: 3 }), now)).toEqual(
      [],
    );
    expect(
      deriveNotifications([resetIn(5)], withNotifications({ resetLeadDays: 7 }), now),
    ).toHaveLength(1);
    expect(deriveNotifications([resetIn(8)], withNotifications({ resetLeadDays: 7 }), now)).toEqual(
      [],
    );
  });
  test("read marks survive a mute, a session switch and a shorter lead", () => {
    const off = withNotifications({
      mutedProviders: ["claude"],
      includeSessions: false,
      resetLeadDays: 1,
    });
    expect(currentIds([busyClaude], off, now).size).toBe(3);
  });
});

const claudeWith = (all: number, scoped: [string, number][]) =>
  connection("claude", {
    id: "d1",
    metrics: [
      percent("seven_day", all, { resetsAt: reset }),
      ...scoped.map(([key, used]) => percent(key, used, { resetsAt: reset })),
    ],
  });

const keptKeys = (conn: ReturnType<typeof claudeWith>) =>
  deriveNotifications([conn], defaultSettings, now).map((item) => item.subject.metricKey);

describe("Claude overlapping weekly limits", () => {
  test("the same tone keeps only the tighter one", () => {
    expect(keptKeys(claudeWith(75, [["limits.Fable", 85]]))).toEqual(["limits.Fable"]);
    expect(keptKeys(claudeWith(85, [["limits.Fable", 75]]))).toEqual(["seven_day"]);
    expect(keptKeys(claudeWith(80, [["limits.Fable", 80]]))).toEqual(["seven_day"]);
    expect(keptKeys(claudeWith(95, [["limits.Fable", 99]]))).toEqual(["limits.Fable"]);
  });
  test("different tones keep both, worst first", () => {
    expect(keptKeys(claudeWith(75, [["limits.Fable", 95]]))).toEqual(["limits.Fable", "seven_day"]);
  });
  test("a scoped limit with no weekly notice, and two scoped limits, are untouched", () => {
    expect(keptKeys(claudeWith(10, [["limits.Fable", 85]]))).toEqual(["limits.Fable"]);
    const two = claudeWith(10, [
      ["limits.Fable", 85],
      ["limits.Opus", 80],
    ]);
    expect(keptKeys(two)).toEqual(["limits.Fable", "limits.Opus"]);
  });
  test("the older Sonnet bucket counts as a model limit", () => {
    expect(keptKeys(claudeWith(75, [["seven_day_sonnet", 80]]))).toEqual(["seven_day_sonnet"]);
  });
  test("other providers are not de-duplicated", () => {
    const codex = connection("codex", {
      metrics: [
        percent("rate_limit.primary_window", 80, { scope: "window:604800s" }),
        percent("rate_limit.secondary_window", 82, { scope: "window:604800s" }),
      ],
    });
    expect(deriveNotifications([codex], defaultSettings, now)).toHaveLength(2);
  });
});

describe("events", () => {
  test("every derived notification is a valid event with no personal identifier", () => {
    const gone = connection("copilot", {
      id: "e1",
      state: "reconnect_required",
      identity: "owner@example.com",
      name: "Mine",
    });
    const items = deriveNotifications([claude, gone], defaultSettings, now);
    for (const item of items) {
      expect(notificationEventSchema.safeParse(item).success).toBe(true);
      expect(JSON.stringify(item)).not.toContain("owner@example.com");
    }
    expect(items.find((item) => item.kind === "disconnected")?.connection.name).toBe("Mine");
  });
});
