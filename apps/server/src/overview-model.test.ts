import { describe, expect, test } from "bun:test";

import { type CollectResult, splitLabel } from "@headroom/core";
import { credentialFixture, FakeConnector } from "@headroom/core/testing";

import type { AppContext } from "./bootstrap.ts";
import { overviewConnections } from "./overview-model.ts";
import { metricJson, ms, resetCreditJson } from "./routes/serialize.ts";
import { testContext } from "./test-helpers.ts";

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
    };
  });
}

type Outcome = "succeeded" | "partial" | "provider_unavailable" | null;

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

    const at = now() + 10_000;
    const batched = overviewConnections(ctx, at);
    expect(batched).toHaveLength(8);
    expect(JSON.stringify(batched)).toBe(JSON.stringify(legacyOverview(ctx, at)));
    // The fixture exercises what the comparison is for.
    const byName = (id: string) => batched.find((entry) => entry.id === id);
    expect(byName(longFail.id)?.latestRun?.failureStreak).toBe(5);
    expect(byName(failing.id)?.latestRun?.failureStreak).toBe(3);
    expect(byName(tied.id)?.snapshot?.metrics).toHaveLength(1);
    expect(byName(withSnapshot.id)?.snapshot?.resetCredits).toHaveLength(2);
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
