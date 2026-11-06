import type { History } from "./history.ts";
import type { Metric, OverviewConnection, ResetCredit } from "./overview.ts";

/** Synthetic data in the shape the connectors produce. No real accounts. */

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
    pace: [],
    automation: { autoReset: null, budgets: [] },
    ...rest,
  };
}

const hour = 3_600_000;

/** One synthetic account with one percent meter and the matching stored history. */
export function accountWithHistory(args: {
  readonly id?: string;
  readonly scope: string;
  readonly key: string;
  readonly used: number;
  readonly resetsAt: number;
  readonly points: [number, number][];
  readonly windows: { start: number | null; end: number }[];
}) {
  const meter = percent(args.key, args.used, { scope: args.scope, resetsAt: args.resetsAt });
  const account = connection("claude", { id: args.id ?? "claude-1", metrics: [meter] });
  const history: History = {
    from: 0,
    to: 0,
    bucketMs: hour,
    retentionDays: 90,
    connections: [
      {
        id: account.id,
        coverage: {
          firstAt: args.points[0]?.[0] ?? null,
          lastAt: null,
          readings: args.points.length,
        },
        series: [
          {
            providerMetricKey: args.key,
            scope: args.scope,
            points: args.points,
            windows: args.windows,
          },
        ],
        failures: [],
        events: [],
      },
    ],
  };
  return { account, history };
}

/** Hourly points rising from `from` to `peak` percent at `to`. */
export function ramp(from: number, to: number, peak: number): [number, number][] {
  const points: [number, number][] = [];
  for (let at = from; at < to; at += hour) points.push([at, (peak * (at - from)) / (to - from)]);
  return points;
}

/** Hourly points held at 100 percent. */
export function full(from: number, to: number): [number, number][] {
  const points: [number, number][] = [];
  for (let at = from; at < to; at += hour) points.push([at, 100]);
  return points;
}

/** Hourly readings rising linearly from `from` percent to `to` percent between two instants. */
export function rise(a: number, b: number, from: number, to: number): [number, number][] {
  const points: [number, number][] = [];
  for (let at = a; at < b; at += hour) points.push([at, from + ((to - from) * (at - a)) / (b - a)]);
  return points;
}
