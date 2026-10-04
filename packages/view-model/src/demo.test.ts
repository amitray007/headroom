import { describe, expect, test } from "bun:test";

import { providers } from "@headroom/core/contracts";

import { demoOverview } from "./demo.ts";
import { deriveNotifications, type NotificationSettings } from "./notifications.ts";
import { overviewConnectionSchema, type Metric, type OverviewConnection } from "./overview.ts";
import { presentPanel } from "./present.ts";

/** The web's `defaultSettings`, restated here so this package does not import from the app. */
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

const anchor = Date.UTC(2026, 9, 3, 12, 0, 0);
const seeds = [1, 2, 7, 42, 99, 1234, 20_261_003, 4_294_967_295];
const minute = 60_000;
const day = 86_400_000;

function metricsOf(connection: OverviewConnection): Metric[] {
  return connection.snapshot?.metrics ?? [];
}

function figures(seed: number): Metric[][] {
  return demoOverview(seed, anchor).connections.map((connection) => metricsOf(connection));
}

function identities(seed: number): (string | null)[] {
  return demoOverview(seed, anchor).connections.map((connection) => connection.identity);
}

function keysOf(provider: string): string[] {
  return demoOverview(1, anchor)
    .connections.filter((c) => c.provider === provider)
    .flatMap((c) =>
      metricsOf(c).map((m) => `${m.providerMetricKey}|${m.kind}|${m.unit}|${m.scope}`),
    );
}

function only(provider: string): OverviewConnection {
  const found = demoOverview(1, anchor).connections.find((c) => c.provider === provider);
  if (found === undefined) throw new Error(`no demo account for ${provider}`);
  return found;
}

function find(connection: OverviewConnection, key: string): Metric | undefined {
  return metricsOf(connection).find((metric) => metric.providerMetricKey === key);
}

describe("demoOverview", () => {
  const { connections, providerOrder } = demoOverview(1, anchor);

  test("every connection parses with the overview schema", () => {
    for (const seed of seeds) {
      for (const connection of demoOverview(seed, anchor).connections) {
        expect(overviewConnectionSchema.safeParse(connection).success).toBe(true);
      }
    }
  });

  test("the same seed and anchor give the same overview", () => {
    expect(demoOverview(1, anchor)).toEqual(demoOverview(1, anchor));
    expect(demoOverview(42, anchor + 5 * minute)).toEqual(demoOverview(42, anchor + 5 * minute));
  });

  test("different seeds give different figures and identities", () => {
    expect(figures(1)).not.toEqual(figures(2));
    expect(identities(1)).not.toEqual(identities(2));
  });

  test("every provider is present, in the default order, with 1 to 3 accounts", () => {
    expect(providerOrder).toEqual([...providers]);
    expect(connections.length).toBeGreaterThanOrEqual(11);
    expect(connections.length).toBeLessThanOrEqual(13);
    const seen = connections.map((connection) => connection.provider);
    expect([...new Set(seen)]).toEqual([...providers]);
    for (const provider of providers) {
      const count = seen.filter((value) => value === provider).length;
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  test("ids start with demo- and are unique", () => {
    for (const connection of connections) expect(connection.id.startsWith("demo-")).toBe(true);
    expect(new Set(connections.map((connection) => connection.id)).size).toBe(connections.length);
  });

  test("most accounts have no custom name, some do", () => {
    const named = connections.filter((connection) => connection.name !== null);
    expect(named.length).toBeGreaterThan(0);
    expect(named.length).toBeLessThan(connections.length / 2);
  });

  test("identities use reserved example domains only, with no repeats within a provider", () => {
    for (const seed of seeds) {
      const all = demoOverview(seed, anchor).connections;
      for (const connection of all) {
        if (connection.provider === "copilot") {
          expect(connection.identity).toMatch(/^[a-z0-9-]+$/);
        } else if (connection.identity !== null) {
          // RFC 2606: example.com/.org/.net and the .example TLD never belong to a real inbox.
          expect(connection.identity).toMatch(
            /^[a-z0-9._]+@(?:example\.(?:com|org|net)|[a-z0-9-]+\.example)$/,
          );
        }
      }
      for (const provider of providers) {
        const own = all.filter((connection) => connection.provider === provider);
        const named = own.map((connection) => connection.identity).filter((id) => id !== null);
        expect(new Set(named).size).toBe(named.length);
      }
    }
  });

  test("an unavailable value is null, never zero", () => {
    for (const connection of connections) {
      for (const metric of metricsOf(connection)) {
        if (metric.availability !== "available" || metric.unlimited === true) {
          expect(metric.valueNum).toBeNull();
          expect(metric.valueText).toBeNull();
        } else {
          expect(metric.valueNum).toBe(Number(metric.valueText));
        }
      }
    }
    const unlimited = find(only("copilot"), "chat.used");
    expect(unlimited?.unlimited).toBe(true);
    expect(unlimited?.valueNum).toBeNull();
    const notAllowed = connections
      .filter((c) => c.provider === "vercel_ai_gateway")
      .map((c) => find(c, "spend.30d"));
    expect(notAllowed.some((metric) => metric?.availability === "not_authorized")).toBe(true);
  });

  test("percentages stay within 0 to 100 and paired figures agree", () => {
    for (const seed of seeds) {
      for (const connection of demoOverview(seed, anchor).connections) {
        for (const metric of metricsOf(connection)) {
          if (metric.kind === "quota_percentage" && metric.valueNum !== null) {
            expect(metric.valueNum).toBeGreaterThanOrEqual(0);
            expect(metric.valueNum).toBeLessThanOrEqual(100);
          }
        }
        const pairs: [string, string][] = [
          ["extra_usage.used", "extra_usage.monthly_limit"],
          ["on_demand.used", "on_demand.limit"],
          ["on_demand.used", "on_demand_cap"],
        ];
        for (const [usedKey, limitKey] of pairs) {
          const used = find(connection, usedKey)?.valueNum;
          const limit = find(connection, limitKey)?.valueNum;
          if (used !== undefined && used !== null && limit !== undefined && limit !== null) {
            expect(used).toBeLessThanOrEqual(limit);
          }
        }
        // A model limit is part of the weekly all-models limit.
        if (connection.provider === "claude") {
          const all = find(connection, "seven_day")?.valueNum ?? 0;
          for (const metric of metricsOf(connection)) {
            if (metric.providerMetricKey.startsWith("limits.")) {
              expect(metric.valueNum ?? 0).toBeLessThanOrEqual(all);
            }
          }
        }
        // Grok product shares add up to, and never exceed, the pool.
        if (connection.provider === "grok") {
          const pool = find(connection, "weekly_pool.used_percent")?.valueNum ?? 0;
          const shares = metricsOf(connection)
            .filter((metric) => metric.providerMetricKey.startsWith("product."))
            .reduce((sum, metric) => sum + (metric.valueNum ?? 0), 0);
          expect(shares).toBeCloseTo(pool, 1);
        }
        // Vercel: the balance and the total used are two parts of what was granted.
        if (connection.provider === "vercel_ai_gateway") {
          const balance = find(connection, "credits.balance")?.valueNum ?? -1;
          const spent = find(connection, "credits.total_used")?.valueNum ?? -1;
          expect(balance).toBeGreaterThan(0);
          expect(spent).toBeGreaterThan(0);
          expect([50, 100, 250]).toContain(Math.round((balance + spent) * 100) / 100);
        }
      }
    }
  });

  test("Copilot's percentage agrees with its credit count", () => {
    const copilot = only("copilot");
    const percent = find(copilot, "credits.used_percent")?.valueNum ?? 0;
    const count = find(copilot, "credits.used_count")?.valueNum ?? 0;
    expect((count / 300) * 100).toBeCloseTo(percent, 1);
  });

  test("each provider uses its own metric keys, kinds, units and scopes", () => {
    expect(keysOf("codex")).toContain(
      "rate_limit.primary_window|quota_percentage|percent|window:18000s",
    );
    expect(keysOf("codex")).toContain(
      "rate_limit.secondary_window|quota_percentage|percent|window:604800s",
    );
    expect(keysOf("codex")).toContain("credits.balance|credits|codex_credits|account");
    expect(keysOf("codex")).toContain(
      "reset_credits.available_count|reset_inventory|resets|account",
    );
    expect(keysOf("claude")).toContain("five_hour|quota_percentage|percent|window:18000s");
    expect(keysOf("claude")).toContain("extra_usage.used|spend|USD|month");
    expect(keysOf("claude")).toContain("extra_usage.monthly_limit|spending_cap|USD|month");
    expect(keysOf("claude")).toContain("reset_grants.available|reset_inventory|resets|account");
    expect(keysOf("grok")).toContain(
      "weekly_pool.used_percent|quota_percentage|percent|window:weekly",
    );
    expect(keysOf("grok")).toContain("on_demand_cap|spending_cap|grok_credits|account");
    expect(keysOf("antigravity")).toContain(
      "quota.gemini-5h|quota_percentage|percent|window:18000s",
    );
    expect(keysOf("antigravity")).toContain(
      "quota.3p-weekly|quota_percentage|percent|window:604800s",
    );
    expect(keysOf("copilot")).toContain("credits.used_count|absolute_quota|credits|month");
    expect(keysOf("cursor")).toContain("included.limit|spending_cap|USD|billing_cycle");
    expect(keysOf("cursor")).toContain("on_demand.limit|spending_cap|USD|on_demand");
    expect(keysOf("vercel_ai_gateway")).toContain("credits.balance|credits|gateway_credits|team");
    expect(keysOf("vercel_ai_gateway")).toContain("spend.30d|spend|USD|team");
  });

  test("only Vercel is official, and every metric carries its connection's label", () => {
    for (const connection of connections) {
      const label = connection.provider === "vercel_ai_gateway" ? "official" : "private";
      expect(connection.interface).toBe(label);
      for (const metric of metricsOf(connection)) expect(metric.interface).toBe(label);
    }
  });

  test("the dashboard panel renders every account like a real one", () => {
    for (const connection of connections) {
      const panel = presentPanel(connection, anchor);
      expect(panel.cells.length).toBeGreaterThan(0);
    }
  });

  test("times are relative to the anchor", () => {
    for (const seed of seeds) {
      for (const connection of demoOverview(seed, anchor).connections) {
        const snapshot = connection.snapshot;
        expect(snapshot).not.toBeNull();
        if (snapshot === null) continue;
        expect(connection.createdAt).toBeLessThanOrEqual(anchor - 3 * 7 * day);
        expect(connection.createdAt).toBeGreaterThanOrEqual(anchor - 15 * 7 * day);
        const needsSignIn = connection.state === "reconnect_required";
        if (!needsSignIn) {
          expect(snapshot.observedAt).toBeGreaterThanOrEqual(anchor - 12 * minute);
          expect(snapshot.observedAt).toBeLessThanOrEqual(anchor - minute);
          expect(connection.lastSuccessAt).toBeGreaterThanOrEqual(anchor - 12 * minute);
          expect(connection.lastSuccessAt).toBeLessThanOrEqual(anchor - minute);
          expect(connection.latestRun?.failureStreak).toBe(0);
          expect(["succeeded", "partial"]).toContain(connection.latestRun?.outcome ?? "");
        }
        for (const metric of snapshot.metrics) {
          if (metric.resetsAt !== null) {
            expect(metric.resetsAt).toBeGreaterThan(anchor);
            const seconds = /^window:(\d+)s$/.exec(metric.scope)?.[1];
            if (seconds !== undefined) {
              expect(metric.resetsAt).toBeLessThanOrEqual(anchor + Number(seconds) * 1000);
            }
            if (metric.scope === "window:weekly") {
              expect(metric.resetsAt).toBeLessThanOrEqual(anchor + 7 * day);
            }
          }
          if (metric.windowStart !== null && metric.windowEnd !== null) {
            expect(metric.windowStart).toBeLessThan(metric.windowEnd);
          }
          if (metric.scope === "window:weekly" && metric.windowEnd !== null) {
            expect(metric.windowEnd - (metric.windowStart ?? 0)).toBe(7 * day);
          }
        }
        for (const credit of snapshot.resetCredits) {
          expect(credit.expiresAt).toBeGreaterThan(anchor);
        }
      }
    }
  });

  test("the output does not read the clock", () => {
    const real = Date.now;
    Date.now = () => {
      throw new Error("demoOverview must not call Date.now");
    };
    try {
      expect(demoOverview(3, anchor).connections.length).toBeGreaterThan(0);
    } finally {
      Date.now = real;
    }
  });

  test("actions mirror the provider and stay switched off", () => {
    for (const connection of connections) {
      expect(connection.actions.enabled).toBe(false);
      expect(connection.actions.supported).toEqual(
        connection.provider === "codex" ? ["consume_reset_credit"] : [],
      );
    }
  });

  test("the default settings give 2 to 4 notifications for any seed", () => {
    for (const seed of seeds) {
      const found = deriveNotifications(
        demoOverview(seed, anchor).connections,
        defaultSettings,
        anchor,
      );
      expect(found.length).toBeGreaterThanOrEqual(2);
      expect(found.length).toBeLessThanOrEqual(4);
    }
  });

  test("the notifications are a believable mix", () => {
    const found = deriveNotifications(connections, defaultSettings, anchor);
    expect(found.map((item) => item.kind).toSorted()).toEqual([
      "disconnected",
      "reset_expiring",
      "running_low",
    ]);
    const disconnected = connections.find((c) => c.state === "reconnect_required");
    expect(disconnected?.reconnectReason).toBe("refresh_rejected");
    expect(disconnected?.provider).toBe("antigravity");
  });
});
