import { describe, expect, test } from "bun:test";

import {
  notificationEventSchema,
  kindSwitches,
  type AccountEvent,
  type NotificationKind,
  type Provider,
} from "@headroom/core/contracts";

import {
  currentIds,
  deriveNotifications,
  expiringTopUps,
  type ExpiringTopUp,
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
    kinds: kindSwitches(true),
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
  test("Cursor's Grok Bot allowance raises its own notice, named after it", () => {
    const cursor = connection("cursor", {
      id: "u1",
      metrics: [
        percent("included.total_percent", 20, { scope: "billing_cycle", resetsAt: reset }),
        percent("grok_bot.used_percent", 92, { scope: "window:604800s", resetsAt: reset }),
      ],
    });
    expect(
      deriveNotifications([cursor], defaultSettings, now).map((n) => [n.tone, n.title]),
    ).toEqual([["bad", "Cursor Is Almost Out of Its Grok Bot Limit"]]);
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
      notifications: {
        ...defaultSettings.notifications,
        ...switchOff("running_low", "almost_out"),
      },
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
      notifications: { ...defaultSettings.notifications, ...switchOff("reset_expiring") },
    };
    expect(deriveNotifications([codex], off, now)).toEqual([]);
  });
});

const run = (startedAt: number, failureStreak = 2) => ({
  startedAt,
  finishedAt: startedAt + 10,
  outcome: "provider_unavailable" as const,
  error: "down",
  failureStreak,
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
  test("one failed refresh is quiet; a second in a row notifies", () => {
    const one = connection("grok", { latestRun: run(100, 1) });
    const two = connection("grok", { latestRun: run(100, 2) });
    expect(deriveNotifications([one], defaultSettings, now)).toEqual([]);
    expect(deriveNotifications([two], defaultSettings, now).map((n) => n.kind)).toEqual([
      "refresh_failed",
    ]);
  });
  test("a run still in progress, a partial run and a disabled switch are quiet", () => {
    const inProgress = connection("grok", {
      latestRun: { startedAt: 1, finishedAt: null, outcome: null, error: null, failureStreak: 0 },
    });
    const partial = connection("grok", {
      latestRun: { startedAt: 1, finishedAt: 2, outcome: "partial", error: null, failureStreak: 0 },
    });
    expect(deriveNotifications([inProgress, partial], defaultSettings, now)).toEqual([]);
    const off = {
      ...defaultSettings,
      notifications: {
        ...defaultSettings.notifications,
        ...switchOff("refresh_failed", "disconnected"),
      },
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

/** Switches the given kinds off and leaves the rest on. */
const switchOff = (...kinds: NotificationKind[]) => ({
  kinds: {
    ...defaultSettings.notifications.kinds,
    ...Object.fromEntries(kinds.map((kind) => [kind, false])),
  },
});

const balanceKinds = ["balance_low", "top_up_detected", "credits_expiring"] as const;
const spendKinds = [
  "spend_near_cap",
  "spend_cap_reached",
  "extra_usage_started",
  "budget_near",
  "budget_exceeded",
] as const;
const resetKinds = ["reset_granted", "early_reset", "auto_reset"] as const;

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
    const off = withNotifications(switchOff(...balanceKinds));
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

/** Cap notices only: starting on-demand use is covered by its own tests. */
const capNotices = (...args: Parameters<typeof deriveNotifications>) =>
  deriveNotifications(...args).filter((item) => item.kind !== "extra_usage_started");

describe("spend notices", () => {
  test("Claude: warns from 70% on the default threshold, reached at 100%, in dollars", () => {
    expect(capNotices([claudeSpend(34, 50)], defaultSettings, now)).toEqual([]);
    const [near] = capNotices([claudeSpend(35, 50)], defaultSettings, now);
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
    const [reached] = capNotices([claudeSpend(50, 50)], defaultSettings, now);
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
    expect(capNotices([claudeSpend(35, 50)], strict, now)).toEqual([]);
    expect(capNotices([claudeSpend(43, 50)], strict, now)[0]?.kind).toBe("spend_near_cap");
  });
  test("Claude without a cap, or with unknown spend, is quiet", () => {
    expect(capNotices([claudeSpend(500, null)], defaultSettings, now)).toEqual([]);
    const unknown = connection("claude", {
      metrics: [
        usd("extra_usage.used", 0, { valueNum: null, valueText: null, availability: "unknown" }),
        usd("extra_usage.monthly_limit", 50),
      ],
    });
    expect(capNotices([unknown], defaultSettings, now)).toEqual([]);
  });
  test("a new month gets a new id", () => {
    const first = capNotices([claudeSpend(40, 50)], defaultSettings, now)[0];
    const later = connection("claude", {
      id: "c2",
      observedAt: now + 40 * 86_400_000,
      metrics: [usd("extra_usage.used", 40), usd("extra_usage.monthly_limit", 50)],
    });
    expect(capNotices([later], defaultSettings, now)[0]?.id).not.toBe(first?.id);
  });
  test("Cursor pairs spend and limit of the same scope only", () => {
    const [item] = capNotices([cursorPair("on_demand:user")], defaultSettings, now);
    expect(item?.title).toBe("Cursor On-Demand Spend Is Near Its Cap");
    expect(capNotices([cursorPair("on_demand:pooled")], defaultSettings, now)).toEqual([]);
  });
  test("Grok counts credits, never dollars, and a cap of 0 is off", () => {
    const [item] = capNotices([grokSpend(900, 1000)], defaultSettings, now);
    expect(item?.message).toBe("900 of 1,000 credits used.");
    expect(item?.figures.amount).toEqual({ value: 900, unit: "grok_credits" });
    expect(item?.message).not.toContain("$");
    expect(capNotices([grokSpend(900, 0)], defaultSettings, now)).toEqual([]);
  });
  test("the switch and inactive accounts silence spend", () => {
    const off = withNotifications(switchOff(...spendKinds));
    expect(capNotices([claudeSpend(50, 50)], off, now)).toEqual([]);
    const gone = { ...claudeSpend(50, 50), state: "reconnect_required" } as const;
    expect(kindsOf(capNotices([gone], defaultSettings, now))).toEqual(["disconnected"]);
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
    const off = withNotifications(switchOff(...spendKinds));
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

// ---------- detected events, budgets and expiring credits (ADR 0003) ----------

const earlyEvent = (key: string, previous = 64, current = 3) =>
  event(
    `r-${key}`,
    {
      kind: "early_reset",
      previousPercent: previous,
      percent: current,
      expectedResetAt: now + 86_400_000,
    },
    { metricKey: key },
  );

const claudeWithEvents = (events: AccountEvent[]) =>
  withEvents("claude", events, {
    metrics: [
      percent("seven_day", 3, { resetsAt: now + 6 * 86_400_000 }),
      percent("five_hour", 3, { scope: "window:18000s", resetsAt: now + 4 * hours }),
    ],
  });

const autoRan = (state: "succeeded" | "failed" | "uncertain") =>
  event(
    `a-${state}`,
    {
      kind: "auto_reset",
      actionId: "act-1",
      state,
      creditId: "rc-1",
      percent: 99.6,
      resetsAt: now + 86_400_000,
    },
    { metricKey: "rate_limit.primary_window" },
  );

const detectedEvent = (unit: "USD" | "gateway_credits", added: number, current: number) =>
  event(
    "t1",
    { kind: "top_up_detected", unit, previous: current - added, current, added, topUpId: "w1" },
    { metricKey: "credits.balance" },
  );

const budgetSet = (amount: number, unit: "USD" | "grok_credits" = "USD") => ({
  autoReset: null,
  budgets: [{ metricKey: "on_demand.used", amount, unit }],
});

const budgetCursor = (used: number, amount: number, over = {}) =>
  connection("cursor", {
    id: "k7",
    observedAt: now,
    metrics: [usd("on_demand.used", used, { scope: "on_demand" })],
    automation: budgetSet(amount),
    ...over,
  });

const budgetOnly = (items: ReturnType<typeof derive>) =>
  items.filter((n) => n.kind.startsWith("budget"));

const expiringTop = (over: Partial<ExpiringTopUp> = {}): ExpiringTopUp => ({
  id: "t1",
  connectionId: "x1",
  date: "2025-09-20",
  credits: 250,
  expiresOn: "2025-10-09",
  expiryAlertDays: 7,
  ...over,
});

const hours = 3_600_000;
const event = (
  id: string,
  detail: AccountEvent["detail"],
  over: Partial<AccountEvent> = {},
): AccountEvent => ({
  id,
  connectionId: "x9",
  occurredAt: now - 2 * hours,
  metricKey: null,
  detail,
  ...over,
});
const withEvents = (provider: Provider, events: AccountEvent[], over = {}) =>
  connection(provider, { id: "x9", observedAt: now - 60_000, events, ...over });
const derive = (items: Parameters<typeof deriveNotifications>[0], settings = defaultSettings) =>
  deriveNotifications(items, settings, now);

describe("reset_granted", () => {
  const granted = event("g1", {
    kind: "reset_granted",
    creditId: "rc-9",
    expiresAt: new Date(2025, 9, 20).getTime(),
    available: 3,
  });
  /** How many notices show for the grant when it happened `age` milliseconds ago. */
  const grantedCount = (age: number) =>
    derive([withEvents("codex", [{ ...granted, occurredAt: now - age }])]).length;
  test("says how many are banked and when the new one expires", () => {
    const [item] = derive([withEvents("codex", [granted])]);
    expect(item).toMatchObject({
      id: "x9:reset_granted:g1",
      kind: "reset_granted",
      tone: "info",
      occurredAt: now - 2 * hours,
      observedAt: now - 60_000,
      title: "Codex Banked a New Reset",
      message: "3 banked resets available. The new one expires Oct 20.",
      subject: { metricKey: null, label: "Banked Resets", window: null },
      figures: { expiresAt: new Date(2025, 9, 20).getTime() },
    });
    expect(notificationEventSchema.safeParse(item).success).toBe(true);
  });
  test("an unknown count or expiry is left out of the words, never zero", () => {
    const bare = event("g2", {
      kind: "reset_granted",
      creditId: "r",
      expiresAt: null,
      available: null,
    });
    const [item] = derive([withEvents("claude", [bare])]);
    expect(item?.message).toBe("The new one has no expiry date.");
    expect(item?.figures).toEqual({});
    const one = event("g3", {
      kind: "reset_granted",
      creditId: "r",
      expiresAt: null,
      available: 1,
    });
    expect(derive([withEvents("claude", [one])])[0]?.message).toBe(
      "1 banked reset available. The new one has no expiry date.",
    );
  });
  test("stays for 72 hours, then goes", () => {
    expect(grantedCount(72 * hours)).toBe(1);
    expect(grantedCount(72 * hours + 1)).toBe(0);
  });
  test("follows the reset activity switch, the muted list and inactive accounts", () => {
    const items = [withEvents("codex", [granted])];
    expect(derive(items, withNotifications(switchOff(...resetKinds)))).toEqual([]);
    expect(derive(items, withNotifications({ mutedProviders: ["codex"] }))).toEqual([]);
    const other = withNotifications(
      switchOff(...balanceKinds, ...spendKinds, "running_low", "almost_out"),
    );
    expect(derive(items, other)).toHaveLength(1);
    expect(derive([withEvents("codex", [granted], { state: "paused" })])).toEqual([]);
  });
  test("each event has its own id, so a second grant is a second notice", () => {
    const second = { ...granted, id: "g9" };
    const ids = derive([withEvents("codex", [granted, second])]).map((n) => n.id);
    expect(ids.toSorted()).toEqual(["x9:reset_granted:g1", "x9:reset_granted:g9"]);
  });
});

describe("early_reset", () => {
  test("names the window and how far usage fell", () => {
    const [item] = derive([claudeWithEvents([earlyEvent("seven_day", 63.6, 2.6)])]);
    expect(item).toMatchObject({
      id: "x9:early_reset:r-seven_day",
      kind: "early_reset",
      tone: "info",
      title: "Claude Weekly Limit Reset Early",
      message: "Usage fell from 64% to 3% before its scheduled reset.",
      figures: { percentUsed: 2.6 },
    });
    expect(item?.figures.percentLeft).toBeCloseTo(97.4);
    expect(notificationEventSchema.safeParse(item).success).toBe(true);
  });
  test("follows the used or left view", () => {
    const left = { ...defaultSettings, limitsView: "left" } as const;
    expect(derive([claudeWithEvents([earlyEvent("seven_day")])], left)[0]?.message).toBe(
      "97% left, up from 36%, before its scheduled reset.",
    );
  });
  test("Include 5-Hour Sessions off skips a session window only", () => {
    const events = [earlyEvent("five_hour"), earlyEvent("seven_day")];
    const ids = derive([claudeWithEvents(events)]).map((n) => n.id);
    expect(ids.toSorted()).toEqual(["x9:early_reset:r-five_hour", "x9:early_reset:r-seven_day"]);
    const off = withNotifications({ includeSessions: false });
    expect(derive([claudeWithEvents(events)], off).map((n) => n.id)).toEqual([
      "x9:early_reset:r-seven_day",
    ]);
  });
  test("a window the reading no longer carries still gets a notice", () => {
    const [item] = derive([withEvents("claude", [earlyEvent("seven_day")], { metrics: [] })]);
    expect(item?.title).toBe("Claude seven_day Limit Reset Early");
  });
  test("follows the reset activity switch", () => {
    const off = withNotifications(switchOff(...resetKinds));
    expect(derive([claudeWithEvents([earlyEvent("seven_day")])], off)).toEqual([]);
  });
});

describe("auto_reset", () => {
  test("a success is information", () => {
    const [item] = derive([withEvents("codex", [autoRan("succeeded")])]);
    expect(item).toMatchObject({
      id: "x9:auto_reset:a-succeeded",
      tone: "info",
      title: "Codex Auto-Reset Used a Banked Reset",
      message: "A limit reached 100% used, so Headroom used a banked reset.",
      figures: { percentUsed: 99.6 },
    });
    expect(notificationEventSchema.safeParse(item).success).toBe(true);
  });
  test("a failure and an unknown outcome warn, each in its own words", () => {
    const failed = derive([withEvents("codex", [autoRan("failed")])])[0];
    expect(failed?.tone).toBe("warn");
    expect(failed?.title).toBe("Codex Auto-Reset Failed");
    expect(failed?.message).toContain("did not go through");
    const unsure = derive([withEvents("codex", [autoRan("uncertain")])])[0];
    expect(unsure?.tone).toBe("warn");
    expect(unsure?.title).toBe("Codex Auto-Reset May Not Have Worked");
    expect(unsure?.message).toContain("could not confirm");
  });
  test("a muted provider still shows a failed or uncertain attempt, not a success", () => {
    const muted = withNotifications({ mutedProviders: ["codex"] });
    const all = [autoRan("succeeded"), autoRan("failed"), autoRan("uncertain")];
    const ids = derive([withEvents("codex", all)], muted).map((n) => n.id);
    expect(ids.toSorted()).toEqual(["x9:auto_reset:a-failed", "x9:auto_reset:a-uncertain"]);
  });
  test("an account that stopped updating still reports a failed attempt", () => {
    const paused = withEvents("codex", [autoRan("failed"), autoRan("succeeded")], {
      state: "paused",
    });
    expect(derive([paused]).map((n) => n.id)).toEqual(["x9:auto_reset:a-failed"]);
  });
  test("the reset activity switch silences all of them", () => {
    const off = withNotifications(switchOff(...resetKinds));
    expect(derive([withEvents("codex", [autoRan("failed"), autoRan("succeeded")])], off)).toEqual(
      [],
    );
  });
});

describe("top_up_detected", () => {
  test("credits never carry a dollar sign", () => {
    const gatewayAccount = withEvents("vercel_ai_gateway", [
      detectedEvent("gateway_credits", 25, 130.5),
    ]);
    const [item] = derive([gatewayAccount]);
    expect(item).toMatchObject({
      id: "x9:top_up_detected:t1",
      tone: "info",
      title: "Vercel AI Gateway Top-Up Detected",
      message: "25 credits added. The balance is now 130.50 credits.",
      figures: { amount: { value: 25, unit: "gateway_credits" } },
    });
    expect(item?.message).not.toContain("$");
    expect(notificationEventSchema.safeParse(item).success).toBe(true);
  });
  test("a dollar amount reads as money", () => {
    const [item] = derive([withEvents("codex", [detectedEvent("USD", 20, 45)])]);
    expect(item?.message).toBe("$20.00 added. The balance is now $45.00.");
  });
  test("follows the balances switch, not the reset activity one", () => {
    const items = [withEvents("codex", [detectedEvent("USD", 20, 45)])];
    expect(derive(items, withNotifications(switchOff(...balanceKinds)))).toEqual([]);
    expect(derive(items, withNotifications(switchOff(...resetKinds)))).toHaveLength(1);
  });
});

describe("budget notices", () => {
  test("warns at 70% of the budget with the default threshold, in dollars", () => {
    expect(budgetOnly(derive([budgetCursor(34.99, 50)]))).toEqual([]);
    const [item] = budgetOnly(derive([budgetCursor(35, 50)]));
    expect(item).toMatchObject({
      id: "k7:budget_near:on_demand.used:2025-10:50",
      kind: "budget_near",
      tone: "warn",
      title: "Cursor On-Demand Spend Is Near Your Budget",
      message: "$35.00 of your $50.00 budget spent.",
      figures: {
        percentUsed: 70,
        percentLeft: 30,
        amount: { value: 35, unit: "USD" },
        cap: { value: 50, unit: "USD" },
      },
    });
    expect(notificationEventSchema.safeParse(item).success).toBe(true);
  });
  test("is exceeded at the budget itself and above", () => {
    for (const used of [50, 61.5]) {
      const [item] = budgetOnly(derive([budgetCursor(used, 50)]));
      expect(item).toMatchObject({
        id: "k7:budget_exceeded:on_demand.used:2025-10:50",
        kind: "budget_exceeded",
        tone: "bad",
        title: "Cursor On-Demand Spend Is Over Your Budget",
      });
    }
  });
  test("the threshold setting moves the line", () => {
    const strict = { ...defaultSettings, lowThresholdPercent: 15 } as const;
    expect(budgetOnly(derive([budgetCursor(41, 50)], strict))).toEqual([]);
    expect(budgetOnly(derive([budgetCursor(42.5, 50)], strict))[0]?.kind).toBe("budget_near");
  });
  test("a new amount or a new month is a new notice", () => {
    const first = budgetOnly(derive([budgetCursor(45, 50)]))[0]?.id;
    expect(budgetOnly(derive([budgetCursor(45, 60)]))[0]?.id).not.toBe(first);
    const later = budgetCursor(45, 50, { observedAt: now + 40 * 86_400_000 });
    expect(budgetOnly(derive([later]))[0]?.id).not.toBe(first);
  });
  test("counts credits for a credit metric, with no dollar sign", () => {
    const grok = connection("grok", {
      id: "g7",
      observedAt: now,
      metrics: [
        metric("on_demand.used", {
          kind: "spend",
          unit: "grok_credits",
          valueNum: 850,
          valueText: "850",
        }),
      ],
      automation: budgetSet(1000, "grok_credits"),
    });
    const [item] = budgetOnly(derive([grok]));
    expect(item?.message).toBe("850 credits of your 1,000 credits budget used.");
    expect(item?.figures.amount).toEqual({ value: 850, unit: "grok_credits" });
    expect(item?.message).not.toContain("$");
  });
  test("is independent of the provider's own cap, which still raises its own notice", () => {
    const both = budgetCursor(48, 50, {
      metrics: [
        usd("on_demand.used", 48, { scope: "on_demand" }),
        usd("on_demand.limit", 50, { scope: "on_demand" }),
      ],
    });
    expect(kindsOf(derive([both])).toSorted()).toEqual([
      "budget_near",
      "extra_usage_started",
      "spend_near_cap",
    ]);
  });
  test("unknown, unlimited and non-spend metrics, and no budget, raise no budget notice", () => {
    const unknown = budgetCursor(0, 50, {
      metrics: [
        usd("on_demand.used", 0, { valueNum: null, valueText: null, availability: "unknown" }),
      ],
    });
    expect(derive([unknown])).toEqual([]);
    const unlimited = budgetCursor(90, 50, {
      metrics: [usd("on_demand.used", 90, { unlimited: true })],
    });
    expect(budgetOnly(derive([unlimited]))).toEqual([]);
    const notSpend = budgetCursor(90, 50, { metrics: [percent("on_demand.used", 90)] });
    expect(budgetOnly(derive([notSpend]))).toEqual([]);
    expect(budgetOnly(derive([budgetCursor(90, 50, { metrics: [] })]))).toEqual([]);
    const none = budgetCursor(90, 50, { automation: { autoReset: null, budgets: [] } });
    expect(budgetOnly(derive([none]))).toEqual([]);
  });
  test("the spend switch, a muted provider and inactive accounts silence it", () => {
    expect(
      budgetOnly(derive([budgetCursor(45, 50)], withNotifications(switchOff(...spendKinds)))),
    ).toEqual([]);
    const muted = withNotifications({ mutedProviders: ["cursor"] });
    expect(budgetOnly(derive([budgetCursor(45, 50)], muted))).toEqual([]);
    expect(budgetOnly(derive([budgetCursor(45, 50, { state: "paused" })]))).toEqual([]);
  });
});

describe("credits_expiring", () => {
  const codexAccount = connection("codex", { id: "x1" });
  const runExpiring = (tops: ExpiringTopUp[], settings = defaultSettings, items = [codexAccount]) =>
    deriveNotifications(items, settings, now, tops);
  test("starts on the alert day and says what expires and when", () => {
    const [item] = runExpiring([expiringTop()]);
    expect(item).toMatchObject({
      id: "x1:credits_expiring:t1:2025-10-09",
      kind: "credits_expiring",
      tone: "warn",
      title: "Codex Credits Expire in 7 Days",
      message: "250 credits from your Sep 20 top-up expire Oct 9.",
      figures: {
        expiresAt: Date.parse("2025-10-09T00:00:00Z"),
        amount: { value: 250, unit: "codex_credits" },
      },
    });
    expect(notificationEventSchema.safeParse(item).success).toBe(true);
    expect(runExpiring([expiringTop({ expiresOn: "2025-10-10" })])).toEqual([]);
  });
  test("counts down, uses the singular, and says today on the day itself", () => {
    expect(runExpiring([expiringTop({ expiresOn: "2025-10-03" })])[0]?.title).toBe(
      "Codex Credits Expire in 1 Day",
    );
    const today = runExpiring([expiringTop({ expiresOn: "2025-10-02" })])[0];
    expect(today?.title).toBe("Codex Credits Expire Today");
    expect(today?.message).toBe("250 credits from your Sep 20 top-up expire today.");
  });
  test("an expiry that has passed raises nothing", () => {
    expect(runExpiring([expiringTop({ expiresOn: "2025-10-01" })])).toEqual([]);
  });
  test("unknown credits are left out of the words", () => {
    const [item] = runExpiring([expiringTop({ credits: null })]);
    expect(item?.message).toBe("Credits from your Sep 20 top-up expire Oct 9.");
    expect(item?.figures.amount).toBeUndefined();
  });
  test("a top-up of an account outside the overview is ignored", () => {
    expect(runExpiring([expiringTop({ connectionId: "gone" })])).toEqual([]);
  });
  test("a longer alert window starts earlier", () => {
    const far = expiringTop({ expiresOn: "2025-10-30", expiryAlertDays: 30 });
    expect(runExpiring([far])[0]?.title).toBe("Codex Credits Expire in 28 Days");
    expect(runExpiring([{ ...far, expiryAlertDays: 14 }])).toEqual([]);
  });
  test("follows the balances switch and a muted provider, not account state", () => {
    expect(runExpiring([expiringTop()], withNotifications(switchOff(...balanceKinds)))).toEqual([]);
    expect(runExpiring([expiringTop()], withNotifications({ mutedProviders: ["codex"] }))).toEqual(
      [],
    );
    const paused = connection("codex", { id: "x1", state: "paused" });
    expect(runExpiring([expiringTop()], defaultSettings, [paused])).toHaveLength(1);
  });
  test("expiringTopUps keeps only the top-ups with both an expiry and an alert", () => {
    const base = { connectionId: "x1", date: "2025-09-20", credits: null };
    const kept = expiringTopUps([
      { ...base, id: "a", expiresOn: "2025-10-09", expiryAlertDays: 7 },
      { ...base, id: "b", expiresOn: "2025-10-09", expiryAlertDays: null },
      { ...base, id: "c", expiresOn: null, expiryAlertDays: null },
    ]);
    expect(kept.map((item) => item.id)).toEqual(["a"]);
  });
  test("currentIds counts it even when its switch is off", () => {
    const off = withNotifications(switchOff(...balanceKinds));
    const ids = currentIds([codexAccount], off, now, [expiringTop()]);
    expect(ids.has("x1:credits_expiring:t1:2025-10-09")).toBe(true);
  });
});

const spendIdAt = (observedAt: number) =>
  derive([connection("cursor", { id: "k1", observedAt, metrics: [usd("on_demand.used", 9)] })])[0]
    ?.id;

describe("extra_usage_started for spend", () => {
  test("Cursor and Grok on-demand use and Claude extra usage start a notice above zero", () => {
    const cursor = connection("cursor", {
      id: "k1",
      observedAt: now,
      metrics: [usd("on_demand.used", 12.5, { scope: "on_demand" })],
    });
    const [item] = derive([cursor]);
    expect(item).toMatchObject({
      id: "k1:extra_usage_started:on_demand.used:2025-10",
      kind: "extra_usage_started",
      tone: "info",
      title: "Cursor Has Started On-Demand Usage",
      message: "$12.50 spent so far.",
      figures: { amount: { value: 12.5, unit: "USD" } },
    });
    expect(notificationEventSchema.safeParse(item).success).toBe(true);
    const extra = connection("claude", { id: "c1", metrics: [usd("extra_usage.used", 3)] });
    expect(derive([extra])[0]?.title).toBe("Claude Has Started Extra Usage");
    const grok = connection("grok", {
      id: "g1",
      metrics: [
        metric("on_demand.used", {
          kind: "spend",
          unit: "grok_credits",
          valueNum: 40,
          valueText: "40",
        }),
      ],
    });
    const grokItem = derive([grok])[0];
    expect(grokItem?.title).toBe("Grok Has Started On-Demand Usage");
    expect(grokItem?.message).toBe("40 credits used so far.");
  });
  test("zero or unknown spend, the switch, and inactive accounts raise nothing", () => {
    const zero = connection("cursor", { metrics: [usd("on_demand.used", 0)] });
    expect(derive([zero])).toEqual([]);
    const unknown = connection("cursor", {
      metrics: [
        usd("on_demand.used", 0, {
          valueNum: null,
          valueText: null,
          availability: "temporarily_unavailable",
        }),
      ],
    });
    expect(derive([unknown])).toEqual([]);
    const spending = connection("cursor", { metrics: [usd("on_demand.used", 9)] });
    expect(derive([spending], withNotifications(switchOff(...spendKinds)))).toEqual([]);
    expect(derive([{ ...spending, state: "paused" }])).toEqual([]);
  });
  test("a new period starts a new notice", () => {
    expect(spendIdAt(now)).not.toBe(spendIdAt(now + 40 * 86_400_000));
  });
});
