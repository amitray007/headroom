import type { Metric, OverviewConnection, ResetCredit } from "./overview.ts";

/** Synthetic data shaped like design/research/data-inventory.md. No real accounts. */

export function metric(key: string, over: Partial<Metric> = {}): Metric {
  return {
    providerMetricKey: key,
    kind: "quota_percentage",
    scope: "window:604800s",
    valueText: null,
    valueNum: null,
    unit: "percent",
    unlimited: false,
    windowStart: null,
    windowEnd: null,
    resetsAt: null,
    availability: "available",
    interface: "private",
    ...over,
  };
}

/** A percent meter with a value. */
export function percent(key: string, used: number, over: Partial<Metric> = {}): Metric {
  return metric(key, { valueText: String(used), valueNum: used, ...over });
}

export function credit(id: string, over: Partial<ResetCredit> = {}): ResetCredit {
  return {
    providerCreditId: id,
    eligible: true,
    usable: true,
    expiresAt: null,
    cooldownUntil: null,
    rawLabel: null,
    ...over,
  };
}

export function connection(
  provider: OverviewConnection["provider"],
  over: Partial<OverviewConnection> & {
    metrics?: Metric[];
    resetCredits?: ResetCredit[];
    observedAt?: number;
  } = {},
): OverviewConnection {
  const { metrics, resetCredits, observedAt, ...rest } = over;
  return {
    id: `${provider}-1`,
    provider,
    scope: "individual",
    state: "ready",
    reconnectReason: null,
    interface: "private",
    authMethod: "cli_login",
    name: null,
    identity: "owner@example.com",
    plan: null,
    createdAt: 1_000,
    lastSuccessAt: 5_000,
    stale: false,
    latestRun: {
      startedAt: 5_000,
      finishedAt: 5_100,
      outcome: "succeeded",
      error: null,
      failureStreak: 0,
    },
    snapshot: {
      observedAt: observedAt ?? 5_000,
      metrics: metrics ?? [],
      resetCredits: resetCredits ?? [],
    },
    actions: { enabled: false, supported: [] },
    events: [],
    automation: { autoReset: null, budgets: [] },
    ...rest,
  };
}
