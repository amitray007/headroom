import { describe, expect, test } from "bun:test";

import { type CollectResult, splitLabel } from "@headroom/core";
import { credentialFixture, FakeConnector } from "@headroom/core/testing";
import { paceOf } from "@headroom/view-model/pace";
import { z } from "zod";

import type { AppContext } from "./bootstrap.ts";
import { overviewConnections } from "./overview-model.ts";
import { metricJson, ms, resetCreditJson } from "./routes/serialize.ts";
import { testContext } from "./test-helpers.ts";

/** Pace the slow way: one query per connection and metric through the same pure estimator. */
function legacyPace(source: AppContext, connectionId: string, now: number) {
  const keys = z.array(z.object({ k: z.string() })).parse(
    source.sqlite
      .query(
        `SELECT DISTINCT m.provider_metric_key AS k FROM snapshots s JOIN metrics m ON m.snapshot_id = s.id
       WHERE s.connection_id = ?`,
      )
      .all(connectionId),
  );
  const out: { metricKey: string; ratePerHour: number; from: number; to: number }[] = [];
  for (const { k } of keys.toSorted((a, b) => a.k.localeCompare(b.k))) {
    const rows = z
      .array(z.object({ at: z.number(), used: z.number(), resetsAt: z.number().nullable() }))
      .parse(
        source.sqlite
          .query(
            `SELECT s.observed_at AS at, m.value_num AS used, m.resets_at AS resetsAt
         FROM snapshots s JOIN metrics m ON m.snapshot_id = s.id
         WHERE s.connection_id = ? AND m.provider_metric_key = ? AND s.observed_at >= ?
           AND m.kind = 'quota_percentage' AND m.availability = 'available' AND m.value_num IS NOT NULL`,
          )
          .all(connectionId, k, now - 25 * 3_600_000),
      );
    const pace = paceOf(rows);
    if (pace) out.push({ metricKey: k, ...pace });
  }
  return out;
}

/** The per-connection implementation the batched one replaced, kept as the reference for byte-identical output. */
function legacyOverview(source: AppContext, now: number) {
  const staleAfterMs = source.config.staleAfterSeconds * 1000;
  return source.order.arrange(source.connections.list()).map((connection) => {
    const run = source.snapshots.latestRun(connection.id);
    const latest = source.snapshots.latest(connection.id);
    const lastSuccessAt = ms(connection.lastSuccessAt);
    const { identity, plan } = splitLabel(connection.provider, connection.label);
    return {
      id: connection.id,
      provider: connection.provider,
      scope: connection.scope,
      state: connection.state,
      reconnectReason: connection.reconnectReason,
      interface: connection.interface,
      authMethod: connection.authMethod,
      name: connection.displayName,
      identity,
      plan,
      createdAt: connection.createdAt.getTime(),
      lastSuccessAt,
      stale: lastSuccessAt === null ? false : now - lastSuccessAt > staleAfterMs,
      latestRun: run
        ? {
            startedAt: run.startedAt.getTime(),
            finishedAt: ms(run.finishedAt),
            outcome: run.outcome,
            error: run.sanitizedError,
            failureStreak: source.snapshots.failureStreak(connection.id),
          }
        : null,
      snapshot: latest
        ? {
            observedAt: latest.snapshot.observedAt.getTime(),
            metrics: latest.metrics.map(metricJson),
            resetCredits: latest.resetCredits.map(resetCreditJson),
          }
        : null,
      actions: {
        enabled: source.actions.enabled,
        supported: [...source.actions.supported(connection.provider)],
      },
      events: source.accountEvents
        .recent(new Date(now - 7 * 86_400_000))
        .filter((event) => event.connectionId === connection.id),
      pace: legacyPace(source, connection.id, now),
      automation: {
        autoReset: source.automation.autoReset(connection.id),
        budgets: source.automation.budgets(connection.id),
      },
    };
  });
}

const base = 1_700_000_000_000 - 22 * 3_600_000;

type Outcome = "succeeded" | "partial" | "provider_unavailable" | null;

const hourMs = 3_600_000;

/** A weekly reading whose reset time stays fixed, so a trail of them has a pace. */
function paced(observedAt: number, percent: number, resetsAt: number): CollectResult {
  const result = collect(observedAt, String(percent));
  for (const metric of result.metrics) Object.assign(metric, { resetsAt });
  return result;
}

function collect(observedAt: number, percent: string, extra = false): CollectResult {
  return {
    observedAt,
    metrics: [
      {
        providerMetricKey: "weekly",
        kind: "quota_percentage",
        scope: "account",
        valueText: percent,
        unit: "percent",
        windowStart: observedAt - 1000,
        windowEnd: observedAt + 1000,
        resetsAt: observedAt + 5000,
        availability: "available",
        interface: "private",
      },
      ...(extra
        ? [
            {
              providerMetricKey: "credits",
              kind: "credits" as const,
              scope: "account",
              valueText: null,
              unit: "usd",
              unlimited: true,
              availability: "unknown" as const,
              interface: "official" as const,
            },
          ]
        : []),
    ],
    resetCredits: extra
      ? [
          {
            providerCreditId: "rc-1",
            eligible: true,
            usable: false,
            cooldownUntil: observedAt + 9,
          },
          { providerCreditId: "rc-2", eligible: false, usable: false, rawLabel: "Synthetic label" },
        ]
      : [],
    failures: [],
  };
}

const detail = (added: number) =>
  ({
    kind: "top_up_detected",
    unit: "codex_credits",
    previous: 1,
    current: 1 + added,
    added,
    topUpId: null,
  }) as const;

function fixture() {
  let clock = 1_700_000_000_000;
  const ctx = testContext(
    { HEADROOM_ENABLED_PROVIDERS: "codex,claude" },
    {
      connectors: [new FakeConnector("codex"), new FakeConnector("claude")],
      now: () => new Date(clock),
    },
  );
  const add = (provider: "codex" | "claude", id: string, label: string) => {
    const row = ctx.connections.create({
      provider,
      identity: { providerAccountId: id, workspaceId: null, label, assurance: "strong" },
      scope: "individual",
      authMethod: "import",
      interface: "private",
      connectorVersion: "fake-1",
    });
    ctx.credentials.put(row.id, credentialFixture());
    return row;
  };
  const run = (connectionId: string, outcome: Outcome, result?: CollectResult) => {
    clock += 1000;
    const started = ctx.snapshots.startRun(connectionId);
    if (result) ctx.snapshots.record(connectionId, started.id, result, "fake-1");
    clock += 10;
    if (outcome) ctx.snapshots.finishRun(started.id, outcome);
  };
  return { ctx, add, run, now: () => clock };
}

describe("overviewConnections", () => {
  test("matches the per-connection implementation on a mixed fixture, byte for byte", () => {
    const { ctx, add, run, now } = fixture();
    add("codex", "none", "Codex (plus)");
    const withSnapshot = add("codex", "snap", "snap@example.com (pro)");
    run(withSnapshot.id, "succeeded", collect(1_700_000_001_000, "10", true));
    run(withSnapshot.id, "succeeded", collect(1_700_000_002_000, "12.5", true));
    const failing = add("claude", "fail", "fail@example.com (max)");
    run(failing.id, "succeeded", collect(1_700_000_003_000, "50"));
    for (const outcome of [
      "provider_unavailable",
      "provider_unavailable",
      null,
      "provider_unavailable",
    ] as const)
      run(failing.id, outcome);
    const longFail = add("claude", "long", "Claude");
    for (let i = 0; i < 7; i++) run(longFail.id, "provider_unavailable");
    const partial = add("codex", "partial", "partial@example.com");
    run(partial.id, "provider_unavailable");
    run(partial.id, "partial", collect(1_700_000_004_000, "1", true));
    const openOnly = add("claude", "open", "open@example.com");
    run(openOnly.id, null);
    // Same observedAt, later receivedAt: the later one is the latest snapshot.
    const tied = add("codex", "tied", "tied@example.com");
    run(tied.id, "succeeded", collect(1_700_000_005_000, "20", true));
    run(tied.id, "succeeded", collect(1_700_000_005_000, "21"));
    add("claude", "late", "late@example.com");
    const burning = add("claude", "burn", "burn@example.com (max)");
    for (let h = 0; h <= 20; h++)
      run(burning.id, "succeeded", paced(base + h * hourMs, 10 + h, base + 100 * hourMs));

    const at = now() + 10_000;
    const batched = overviewConnections(ctx, at);
    expect(batched).toHaveLength(9);
    expect(JSON.stringify(batched)).toBe(JSON.stringify(legacyOverview(ctx, at)));
    // The fixture exercises what the comparison is for.
    const byName = (id: string) => batched.find((entry) => entry.id === id);
    expect(byName(longFail.id)?.latestRun?.failureStreak).toBe(5);
    expect(byName(failing.id)?.latestRun?.failureStreak).toBe(3);
    expect(byName(tied.id)?.snapshot?.metrics).toHaveLength(1);
    expect(byName(withSnapshot.id)?.snapshot?.resetCredits).toHaveLength(2);
    expect(byName(burning.id)?.pace).toHaveLength(1);
    expect(byName(withSnapshot.id)?.pace).toEqual([]);
  });

  test("attaches the burn rate of stored readings and leaves a thin trail unknown", () => {
    const { ctx, add, run } = fixture();
    const burning = add("codex", "burn", "burn@example.com");
    const thin = add("codex", "thin", "thin@example.com");
    for (let h = 0; h <= 20; h++)
      run(burning.id, "succeeded", paced(base + h * hourMs, 10 + h, base + 100 * hourMs));
    for (let h = 18; h <= 20; h++)
      run(thin.id, "succeeded", paced(base + h * hourMs, 10 + h, base + 100 * hourMs));
    const at = base + 21 * hourMs;
    const rows = overviewConnections(ctx, at);
    expect(rows.find((row) => row.id === burning.id)?.pace).toEqual([
      { metricKey: "weekly", ratePerHour: 1, from: base, to: base + 20 * hourMs },
    ]);
    expect(rows.find((row) => row.id === thin.id)?.pace).toEqual([]);
  });

  test("reuses the pace until a new snapshot is stored", () => {
    const { ctx, add, run } = fixture();
    const burning = add("codex", "burn", "burn@example.com");
    for (let h = 0; h <= 20; h++)
      run(burning.id, "succeeded", paced(base + h * hourMs, 10 + h, base + 100 * hourMs));
    const at = base + 21 * hourMs;
    const statements = () => {
      let count = 0;
      const original = ctx.sqlite.query.bind(ctx.sqlite);
      ctx.sqlite.query = (sql: string) => {
        if (sql.includes("m.resets_at")) count += 1;
        return original(sql);
      };
      return { count: () => count, restore: () => (ctx.sqlite.query = original) };
    };
    const probe = statements();
    overviewConnections(ctx, at);
    overviewConnections(ctx, at);
    expect(probe.count()).toBe(1);
    run(burning.id, "succeeded", paced(base + 21 * hourMs, 31, base + 100 * hourMs));
    const after = overviewConnections(ctx, at);
    probe.restore();
    expect(probe.count()).toBe(2);
    expect(after[0]?.pace[0]?.to).toBe(base + 21 * hourMs);
  });

  test("carries each account's recent events, rule and budgets", () => {
    const { ctx, add, now } = fixture();
    const a = add("codex", "a", "a@example.com");
    const b = add("codex", "b", "b@example.com");
    const at = now();
    ctx.accountEvents.record(a.id, at - 8 * 86_400_000, "credits.balance", detail(1));
    ctx.accountEvents.record(a.id, at - 2000, "credits.balance", detail(2));
    ctx.accountEvents.record(a.id, at - 1000, "credits.balance", detail(3));
    const rule = {
      enabled: true,
      window: "weekly",
      thresholdPercent: 95,
      minHoursLeft: 12,
    } as const;
    ctx.automation.setAutoReset(a.id, rule);
    ctx.automation.setBudget(a.id, "on_demand.used", 50, "USD");
    const rows = overviewConnections(ctx, at);
    const first = rows.find((row) => row.id === a.id);
    expect(first?.events.map((e) => e.occurredAt)).toEqual([at - 1000, at - 2000]);
    expect(first?.automation).toEqual({
      autoReset: rule,
      budgets: [{ metricKey: "on_demand.used", amount: 50, unit: "USD" }],
    });
    const second = rows.find((row) => row.id === b.id);
    expect(second?.events).toEqual([]);
    expect(second?.automation).toEqual({ autoReset: null, budgets: [] });
  });

  test("runs a constant number of statements however many connections there are", () => {
    const { ctx, add, run, now } = fixture();
    const count = (n: number) => {
      for (let i = 0; i < n; i++) {
        const row = add("codex", `c${n}-${i}`, `c${n}-${i}@example.com`);
        run(row.id, "succeeded", collect(1_700_000_000_000 + i, "5", true));
      }
      let statements = 0;
      const original = ctx.sqlite.query.bind(ctx.sqlite);
      ctx.sqlite.query = (sql: string) => {
        statements += 1;
        return original(sql);
      };
      overviewConnections(ctx, now());
      ctx.sqlite.query = original;
      return statements;
    };
    expect(count(3)).toBe(count(30));
  });
});
