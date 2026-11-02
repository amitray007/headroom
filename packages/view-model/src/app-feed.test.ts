import { describe, expect, test } from "bun:test";
import { kindSwitches } from "@headroom/core/contracts";

import { appFeedSchema, buildAppFeed } from "./app-feed.ts";
import { demoOverview } from "./demo.ts";
import { deriveNotifications, expiringTopUps } from "./notifications.ts";
import { connection, credit, metric, percent } from "./test-fixtures.ts";
import { emptyBook, type WalletBook } from "./wallet.ts";
import { demoWallet } from "./wallet-demo.ts";

const hour = 3_600_000;
const now = Date.UTC(2026, 9, 29, 15);
const settings = {
  limitsView: "used" as const,
  lowThresholdPercent: 30 as const,
  timeStyle: "countdown" as const,
  clock: "24h" as const,
  notifications: {
    kinds: kindSwitches(true),
    includeSessions: true,
    resetLeadDays: 3 as const,
    mutedProviders: [],
  },
};

function build(
  connections = [connection("claude")],
  overrides: Partial<Parameters<typeof buildAppFeed>[0]> = {},
) {
  return buildAppFeed({
    connections,
    providerOrder: ["claude", "codex", "cursor"],
    serverVersion: "test",
    generatedAt: now,
    refreshIntervalMs: 900_000,
    staleAfterMs: 1_800_000,
    dashboardUrl: null,
    settings,
    wallet: emptyBook,
    rates: null,
    tzOffsetMinutes: 0,
    read: new Set<string>(),
    ...overrides,
  });
}

describe("app feed", () => {
  test("all demo providers parse, with only explicit public fields", () => {
    for (const seed of [1, 2, 42]) {
      const demo = demoOverview(seed, now);
      const wallet = demoWallet(seed, demo.connections, now);
      const feed = build(demo.connections, {
        providerOrder: demo.providerOrder,
        wallet,
        rates: {
          USD: 1,
          INR: 80,
          EUR: 0.9,
          GBP: 0.8,
          CAD: 1.4,
          AUD: 1.5,
          JPY: 150,
          SGD: 1.3,
          CHF: 0.9,
          BRL: 5,
        },
      });
      expect(appFeedSchema.parse(feed)).toEqual(feed);
      expect(feed.accounts).toHaveLength(demo.connections.length);
      expect(feed.accounts.map((account) => account.id)).toEqual(
        demo.connections.map((account) => account.id),
      );
      expect(feed.summary.monthlyPlanTotal?.currency).toBe("USD");
      expect(appFeedSchema.safeParse({ ...feed, unexpected: true }).success).toBe(false);
      expect(
        appFeedSchema.safeParse({
          ...feed,
          accounts: [{ ...feed.accounts[0], credential: "secret" }],
        }).success,
      ).toBe(false);
    }
  });

  test("unknown limits, charges, reset inventory and missing snapshots stay null", () => {
    const unknown = connection("codex", {
      metrics: [
        metric("rate_limit.primary_window", { resetsAt: now + hour }),
        metric("credits.balance", {
          kind: "credits",
          unit: "codex_credits",
          availability: "unknown",
          valueNum: 999,
        }),
        metric("reset_credits.available_count", {
          kind: "reset_inventory",
          unit: "resets",
          availability: "unknown",
          valueNum: 999,
        }),
      ],
    });
    const feed = build([unknown, connection("claude", { snapshot: null, lastSuccessAt: null })]);
    expect(feed.accounts[0]?.limits[0]?.percentLeft).toBeNull();
    expect(feed.accounts[0]?.limits[0]?.runsOutAt).toBeNull();
    expect(feed.accounts[0]?.charges[0]?.value).toBeNull();
    expect(feed.accounts[0]?.banked?.count).toBeNull();
    expect(feed.accounts[1]?.observedAt).toBeNull();
    expect(feed.accounts[1]?.lastSuccessAt).toBeNull();
    expect(feed.summary.monthlyPlanTotal).toBeNull();
    expect(feed.summary.nextLimitBack).toBeNull();
    expect(feed.summary.extraSpend).toEqual([]);
  });

  test("private identities, credentials, raw responses and errors never enter the projection", () => {
    const fixture = {
      ...connection("claude", {
        metrics: [percent("seven_day", 95, { resetsAt: now + 72 * hour })],
      }),
      providerAccountId: "forbidden-provider-account",
      workspaceId: "forbidden-workspace",
      credential: {
        accessToken: "forbidden-access-token",
        refreshToken: "forbidden-refresh-token",
      },
      rawResponse: "forbidden-raw-response",
      latestRun: {
        startedAt: now,
        finishedAt: now,
        outcome: "provider_unavailable" as const,
        error: "forbidden-run-error",
        failureStreak: 2,
      },
    };
    const feed = build([fixture]);
    const serialized = JSON.stringify(feed);
    for (const value of [
      fixture.providerAccountId,
      fixture.workspaceId,
      ...Object.values(fixture.credential),
      fixture.rawResponse,
      fixture.latestRun.error,
    ])
      expect(serialized).not.toContain(value);
    for (const field of [
      "providerAccountId",
      "workspaceId",
      "credential",
      "accessToken",
      "refreshToken",
      "rawResponse",
      '"error"',
      "latestRun",
      "providerCreditId",
    ])
      expect(serialized).not.toContain(field);
    expect(feed.notices.length).toBeGreaterThan(0);
  });

  test("run-out stays anchored to the reading; missing pace and non-weekly windows do not project", () => {
    const account = connection("claude", {
      observedAt: now,
      metrics: [
        percent("seven_day", 60, { resetsAt: now + 100 * hour }),
        percent("five_hour", 40, { scope: "window:18000s", resetsAt: now + 4 * hour }),
      ],
      pace: [
        { metricKey: "seven_day", ratePerHour: 2, from: now - 24 * hour, to: now },
        { metricKey: "five_hour", ratePerHour: 30, from: now - hour, to: now },
      ],
    });
    const initial = build([account]);
    const later = build([account], { generatedAt: now + 2 * hour });
    expect(initial.accounts[0]?.limits.find((limit) => limit.key === "seven_day")?.runsOutAt).toBe(
      now + 20 * hour,
    );
    expect(later.accounts[0]?.limits).toEqual(initial.accounts[0]?.limits);
    expect(
      initial.accounts[0]?.limits.find((limit) => limit.key === "five_hour")?.runsOutAt,
    ).toBeNull();
    expect(
      build([{ ...account, pace: [] }]).accounts[0]?.limits.every(
        (limit) => limit.runsOutAt === null,
      ),
    ).toBe(true);
  });

  test("a run-out under a day before the reset shows in the feed without a pacing notice", () => {
    const account = connection("claude", {
      observedAt: now,
      metrics: [percent("seven_day", 60, { resetsAt: now + 30 * hour })],
      pace: [{ metricKey: "seven_day", ratePerHour: 2, from: now - 24 * hour, to: now }],
    });
    const feed = build([account]);
    expect(feed.accounts[0]?.limits[0]?.runsOutAt).toBe(now + 20 * hour);
    expect(feed.notices.some((notice) => notice.kind === "pacing")).toBe(false);
    const lasting = build([{ ...account, pace: [{ ...account.pace[0]!, ratePerHour: 1 }] }]);
    expect(lasting.accounts[0]?.limits[0]?.runsOutAt).toBeNull();
  });

  test("fractional pacing yields valid integer instants in both limits and notices", () => {
    const account = connection("claude", {
      observedAt: now,
      metrics: [percent("seven_day", 60, { resetsAt: now + 100 * hour })],
      pace: [{ metricKey: "seven_day", ratePerHour: 1.7, from: now - 24 * hour, to: now }],
    });
    const feed = build([account]);
    const at = Math.round(now + (40 / 1.7) * hour);
    expect(feed.accounts[0]?.limits[0]?.runsOutAt).toBe(at);
    expect(feed.notices.find((notice) => notice.kind === "pacing")?.figures.runsOutAt).toBe(at);
  });

  test("a cap is folded into the figure it limits, not listed as its own charge", () => {
    const claude = connection("claude", {
      metrics: [
        metric("cloud_credits.remaining", { kind: "currency_balance", unit: "USD", valueNum: 40 }),
        metric("cloud_credits.limit", { kind: "currency_balance", unit: "USD", valueNum: 250 }),
      ],
    });
    const charges = build([claude]).accounts[0]?.charges ?? [];
    expect(charges.map((charge) => charge.key)).toEqual(["cloud_credits.remaining"]);
    expect(charges[0]?.cap).toEqual({ value: 250, unit: "USD" });
    const off = connection("claude", {
      metrics: [
        metric("cloud_credits.remaining", { kind: "currency_balance", unit: "USD", valueNum: 40 }),
        metric("cloud_credits.limit", { kind: "currency_balance", unit: "USD", valueNum: 0 }),
      ],
    });
    expect(build([off]).accounts[0]?.charges[0]?.cap).toBeNull();
  });

  test("Cursor parts, provider caps, units, banked expiries and the next exhausted limit", () => {
    const cursor = connection("cursor", {
      metrics: [
        percent("included.total_percent", 100, { scope: "billing_cycle", resetsAt: now + hour }),
        percent("included.auto_percent", 100, { scope: "billing_cycle", resetsAt: now + hour / 2 }),
        metric("on_demand.used", {
          kind: "spend",
          unit: "USD",
          valueNum: 12.4,
          scope: "billing_cycle",
        }),
        metric("on_demand.limit", {
          kind: "spending_cap",
          unit: "USD",
          valueNum: 50,
          scope: "billing_cycle",
        }),
      ],
    });
    const grok = connection("grok", {
      metrics: [metric("on_demand.used", { kind: "spend", unit: "grok_credits", valueNum: 7 })],
    });
    const codex = connection("codex", {
      metrics: [
        metric("reset_credits.available_count", {
          kind: "reset_inventory",
          unit: "resets",
          valueNum: 2,
        }),
      ],
      resetCredits: [
        credit("synthetic-credit-2", { expiresAt: now + 2 * hour }),
        credit("synthetic-credit-1", { expiresAt: now + hour }),
      ],
    });
    const feed = build([cursor, grok, codex]);
    expect(
      feed.accounts[0]?.limits.find((limit) => limit.key === "included.auto_percent")?.part,
    ).toBe(true);
    expect(feed.accounts[0]?.charges[0]?.cap).toEqual({ value: 50, unit: "USD" });
    expect(feed.summary.extraSpend).toEqual([
      { unit: "grok_credits", value: 7 },
      { unit: "USD", value: 12.4 },
    ]);
    expect(feed.summary.nextLimitBack).toEqual({
      accountId: cursor.id,
      metricKey: "included.total_percent",
      at: now + hour,
    });
    expect(feed.accounts[2]?.banked).toMatchObject({
      count: 2,
      expiries: [now + hour, now + 2 * hour],
    });
    expect(feed.accounts[0]?.charges[0]?.interface).toBe("private");
    const foreignCap = {
      ...cursor,
      snapshot: {
        ...cursor.snapshot!,
        metrics: cursor.snapshot!.metrics.map((item) =>
          item.kind === "spending_cap" ? Object.assign({}, item, { scope: "another_cycle" }) : item,
        ),
      },
    };
    expect(build([foreignCap]).accounts[0]?.charges[0]?.cap).toBeNull();
  });

  test("unread spend makes its unit total unknown without changing another unit", () => {
    const account = connection("claude", {
      metrics: [
        metric("extra_usage.used", { kind: "spend", unit: "USD", availability: "unknown" }),
      ],
    });
    const known = connection("cursor", {
      metrics: [metric("on_demand.used", { kind: "spend", unit: "USD", valueNum: 5 })],
    });
    expect(build([account, known]).summary.extraSpend).toEqual([{ unit: "USD", value: null }]);
  });

  test("Wallet conversion uses monthly prices, with unknown for missing exchange rates", () => {
    const accounts = [connection("claude"), connection("codex")];
    const wallet: WalletBook = {
      ...emptyBook,
      displayCurrency: "INR",
      costs: {
        "claude-1": {
          kind: "paid",
          price: { minor: 24000, currency: "USD" },
          cycle: "annual",
          renewsOn: null,
        },
        "codex-1": {
          kind: "paid",
          price: { minor: 10000, currency: "INR" },
          cycle: "monthly",
          renewsOn: null,
        },
      },
    };
    expect(build(accounts, { wallet }).summary.monthlyPlanTotal).toBeNull();
    expect(
      build(accounts, { wallet, rates: { USD: 1, INR: 80 } }).summary.monthlyPlanTotal,
    ).toEqual({ minor: 170000, currency: "INR" });
    expect(
      build(accounts, { wallet: { ...emptyBook, costs: { "claude-1": { kind: "free" } } } }).summary
        .monthlyPlanTotal,
    ).toEqual({ minor: 0, currency: "USD" });
  });

  test("notices use the shared delivery derivation, exact time, request offset and Wallet top-ups", () => {
    const account = connection("claude", {
      observedAt: now,
      metrics: [percent("seven_day", 95, { resetsAt: now + 2 * hour })],
    });
    const wallet: WalletBook = {
      ...emptyBook,
      topUps: [
        {
          id: "top-up",
          connectionId: account.id,
          date: "2026-10-01",
          kind: "free",
          price: null,
          credits: 5,
          note: null,
          source: "owner",
          expiresOn: "2026-10-30",
          expiryAlertDays: 7,
        },
      ],
    };
    const feed = build([account], {
      wallet,
      dashboardUrl: "https://headroom.example",
      tzOffsetMinutes: 330,
    });
    const shared = deriveNotifications(
      [account],
      { ...settings, timeStyle: "exact", tzOffsetMinutes: 330 },
      now,
      expiringTopUps(wallet.topUps),
    );
    expect(feed.notices).toEqual(
      shared.map((event) =>
        Object.assign({}, event, { read: false, links: { dashboard: "https://headroom.example" } }),
      ),
    );
    expect(feed.notices.find((notice) => notice.kind === "almost_out")?.message).toContain(
      "at 22:30",
    );
    expect(feed.notices.some((notice) => notice.kind === "credits_expiring")).toBe(true);
  });

  test("a notice carries read when its id is in the read set, whatever the offset", () => {
    const account = connection("claude", { metrics: [percent("seven_day", 95)] });
    const [first] = build([account]).notices;
    expect(first?.read).toBe(false);
    for (const tzOffsetMinutes of [0, 330, -720]) {
      const feed = build([account], { tzOffsetMinutes, read: new Set([first!.id]) });
      expect(feed.notices.map((notice) => [notice.id, notice.read])).toEqual([[first!.id, true]]);
    }
  });
});
