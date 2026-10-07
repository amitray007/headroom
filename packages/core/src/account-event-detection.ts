import type { CollectResult } from "./connector.ts";
import { notificationAmountUnitSchema } from "./enums.ts";
import type { Availability, MetricKind, Provider } from "./enums.ts";
import type { AccountEventDetail } from "./automation-schemas.ts";

/**
 * Compares two readings of one account and names what changed. Pure: no clock, no database.
 * The rules are in docs/decisions/0003-owner-automations.md ("Account events"). Only a metric
 * that is `available` with a finite number counts, so an unknown reading never looks like zero.
 */

export interface ReadingMetric {
  readonly providerMetricKey: string;
  readonly kind: MetricKind;
  readonly unit: string;
  readonly valueNum: number | null;
  readonly availability: Availability;
  readonly unlimited?: boolean;
  readonly resetsAt: number | null;
}

export interface ReadingCredit {
  readonly providerCreditId: string;
  readonly usable: boolean;
  readonly expiresAt: number | null;
}

export interface Reading {
  readonly metrics: readonly ReadingMetric[];
  readonly resetCredits: readonly ReadingCredit[];
}

/** An event the caller still has to store. `topUpId` is filled in once the Wallet row exists. */
export interface EventDraft {
  readonly metricKey: string | null;
  readonly detail: AccountEventDetail;
}

export interface DetectInput {
  readonly provider: Provider;
  /** The previous reading of this account, or null on the first one. */
  readonly previous: Reading | null;
  readonly current: Reading;
  /** When the current reading was true, in epoch milliseconds. */
  readonly observedAt: number;
  /** An action of this account started or ended since the previous reading and may explain a drop. */
  readonly actionSincePrevious: boolean;
}

/** A percent limit must have used at least this much before, and at most `earlyResetToPercent` after. */
const earlyResetFromPercent = 10;
const earlyResetToPercent = 5;
const earlyResetMinDrop = 10;
const earlyResetMinAwayMs = 10 * 60_000;
const topUpMinimum = 0.01;

/** Credit balance keys per provider. Vercel also has a total used, which makes the granted total. */
const balanceKeys: Partial<Record<Provider, { balance: string; totalUsed?: string }>> = {
  codex: { balance: "credits.balance" },
  grok: { balance: "prepaid_balance" },
  vercel_ai_gateway: { balance: "credits.balance", totalUsed: "credits.total_used" },
};

function numberOf(text: string | null): number | null {
  if (text === null || text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function readingFromCollect(result: CollectResult): Reading {
  return {
    metrics: result.metrics.map((metric) => ({
      providerMetricKey: metric.providerMetricKey,
      kind: metric.kind,
      unit: metric.unit,
      valueNum: numberOf(metric.valueText),
      availability: metric.availability,
      unlimited: metric.unlimited ?? false,
      resetsAt: metric.resetsAt ?? null,
    })),
    resetCredits: (result.resetCredits ?? []).map((credit) => ({
      providerCreditId: credit.providerCreditId,
      usable: credit.usable,
      expiresAt: credit.expiresAt ?? null,
    })),
  };
}

/** The shape of `SnapshotStore.latest`, narrowed to what detection reads. */
export interface StoredReading {
  readonly metrics: readonly {
    providerMetricKey: string;
    kind: MetricKind;
    unit: string;
    valueText: string | null;
    valueNum: number | null;
    availability: Availability;
    unlimited: boolean;
    resetsAt: Date | null;
  }[];
  readonly resetCredits: readonly {
    providerCreditId: string;
    usable: boolean;
    expiresAt: Date | null;
  }[];
}

export function readingFromStored(stored: StoredReading): Reading {
  return {
    metrics: stored.metrics.map((metric) => ({
      providerMetricKey: metric.providerMetricKey,
      kind: metric.kind,
      unit: metric.unit,
      valueNum: metric.valueNum ?? numberOf(metric.valueText),
      availability: metric.availability,
      unlimited: metric.unlimited,
      resetsAt: metric.resetsAt?.getTime() ?? null,
    })),
    resetCredits: stored.resetCredits.map((credit) => ({
      providerCreditId: credit.providerCreditId,
      usable: credit.usable,
      expiresAt: credit.expiresAt?.getTime() ?? null,
    })),
  };
}

/** A metric that is available, limited and has a finite number, else null. */
function figure(reading: Reading, key: string): (ReadingMetric & { valueNum: number }) | null {
  const metric = reading.metrics.find((m) => m.providerMetricKey === key);
  if (!metric || metric.availability !== "available" || metric.unlimited === true) return null;
  return metric.valueNum !== null && Number.isFinite(metric.valueNum)
    ? { ...metric, valueNum: metric.valueNum }
    : null;
}

export function detectAccountEvents(input: DetectInput): EventDraft[] {
  const { previous } = input;
  if (previous === null) return [];
  return [
    ...detectResetGranted(input, previous),
    ...detectEarlyReset(input, previous),
    ...detectTopUp(input, previous),
  ];
}

/** Claude's ids come from the grant's position, so a shifted list can reuse an id: its expiry must match too. */
function creditKey(provider: Provider, credit: ReadingCredit): string {
  return provider === "claude"
    ? `${credit.providerCreditId}|${credit.expiresAt ?? ""}`
    : credit.providerCreditId;
}

/** Whether the reading reports its reset inventory. A withheld or unknown one is not "no credits". */
function hasInventory(reading: Reading): boolean {
  return reading.metrics.some(
    (m) => m.kind === "reset_inventory" && m.availability === "available" && m.valueNum !== null,
  );
}

function detectResetGranted(input: DetectInput, previous: Reading): EventDraft[] {
  if (input.provider !== "codex" && input.provider !== "claude") return [];
  if (!hasInventory(previous) || !hasInventory(input.current)) return [];
  const known = new Set(previous.resetCredits.map((c) => creditKey(input.provider, c)));
  const usableNow = input.current.resetCredits.filter((c) => c.usable);
  const rise = usableNow.length - previous.resetCredits.filter((c) => c.usable).length;
  if (rise <= 0) return [];
  return usableNow
    .filter((credit) => !known.has(creditKey(input.provider, credit)))
    .slice(0, rise)
    .map((credit) => ({
      metricKey: null,
      detail: {
        kind: "reset_granted",
        creditId: credit.providerCreditId,
        expiresAt: credit.expiresAt,
        available: usableNow.length,
      },
    }));
}

/**
 * A usable banked reset left the inventory between the two readings and had not expired. With no Headroom action
 * to explain it, the owner spent it somewhere else, such as the provider's own app.
 */
function bankedResetUsed(input: DetectInput, previous: Reading): boolean {
  if (input.provider !== "codex" && input.provider !== "claude") return false;
  if (!hasInventory(previous) || !hasInventory(input.current)) return false;
  const usableNow = input.current.resetCredits.filter((c) => c.usable);
  const usableBefore = previous.resetCredits.filter((c) => c.usable);
  if (usableNow.length >= usableBefore.length) return false;
  const kept = new Set(usableNow.map((c) => creditKey(input.provider, c)));
  return usableBefore.some(
    (credit) =>
      !kept.has(creditKey(input.provider, credit)) &&
      (credit.expiresAt === null || credit.expiresAt > input.observedAt),
  );
}

function detectEarlyReset(input: DetectInput, previous: Reading): EventDraft[] {
  if (input.actionSincePrevious) return [];
  const banked = bankedResetUsed(input, previous);
  const drafts: EventDraft[] = [];
  for (const metric of input.current.metrics) {
    if (metric.kind !== "quota_percentage") continue;
    const now = figure(input.current, metric.providerMetricKey);
    const before = figure(previous, metric.providerMetricKey);
    if (!now || !before) continue;
    const expected = before.resetsAt;
    if (expected === null || expected - input.observedAt <= earlyResetMinAwayMs) continue;
    if (
      before.valueNum >= earlyResetFromPercent &&
      now.valueNum <= earlyResetToPercent &&
      before.valueNum - now.valueNum >= earlyResetMinDrop
    ) {
      drafts.push({
        metricKey: metric.providerMetricKey,
        detail: {
          kind: "early_reset",
          previousPercent: before.valueNum,
          percent: now.valueNum,
          expectedResetAt: expected,
          ...(banked ? { bankedUsed: true as const } : {}),
        },
      });
    }
  }
  return drafts;
}

function detectTopUp(input: DetectInput, previous: Reading): EventDraft[] {
  const keys = balanceKeys[input.provider];
  if (!keys) return [];
  const balanceNow = figure(input.current, keys.balance);
  const balanceBefore = figure(previous, keys.balance);
  if (!balanceNow || !balanceBefore) return [];
  const unit = notificationAmountUnitSchema.safeParse(balanceNow.unit);
  if (!unit.success || balanceNow.unit !== balanceBefore.unit) return [];
  let before = balanceBefore.valueNum;
  let now = balanceNow.valueNum;
  if (keys.totalUsed) {
    // Spend lowers the balance and raises total used, so their sum moves only when credits are granted.
    const usedNow = figure(input.current, keys.totalUsed);
    const usedBefore = figure(previous, keys.totalUsed);
    if (usedNow && usedBefore) {
      before += usedBefore.valueNum;
      now += usedNow.valueNum;
    }
  }
  // Rounded so float noise from summing two readings never shows as a rise.
  const added = Math.round((now - before) * 1e6) / 1e6;
  if (added < topUpMinimum - 1e-9) return [];
  return [
    {
      metricKey: keys.balance,
      detail: {
        kind: "top_up_detected",
        unit: unit.data,
        previous: before,
        current: now,
        added,
        topUpId: null,
      },
    },
  ];
}
