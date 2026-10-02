import type { MetricRow, SnapshotStore } from "@headroom/core";

/** Every instant leaves the API as epoch milliseconds; the web client's schemas expect numbers, not ISO strings. */
export function ms(value: Date | null | undefined): number | null {
  return value?.getTime() ?? null;
}

type Latest = NonNullable<ReturnType<SnapshotStore["latest"]>>;

export function metricJson(metric: MetricRow) {
  return {
    providerMetricKey: metric.providerMetricKey,
    kind: metric.kind,
    scope: metric.scope,
    valueText: metric.valueText,
    valueNum: metric.valueNum,
    unit: metric.unit,
    unlimited: metric.unlimited,
    windowStart: ms(metric.windowStart),
    windowEnd: ms(metric.windowEnd),
    resetsAt: ms(metric.resetsAt),
    availability: metric.availability,
    interface: metric.interface,
  };
}

export function resetCreditJson(credit: Latest["resetCredits"][number]) {
  return {
    providerCreditId: credit.providerCreditId,
    eligible: credit.eligible,
    usable: credit.usable,
    expiresAt: ms(credit.expiresAt),
    cooldownUntil: ms(credit.cooldownUntil),
    rawLabel: credit.rawLabel,
  };
}
