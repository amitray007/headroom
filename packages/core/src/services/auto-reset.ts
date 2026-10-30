import type { AccountEventStore } from "../account-events.ts";
import type { ActionStore } from "../actions.ts";
import type { AutomationStore } from "../automation.ts";
import type { ConnectionStore } from "../lifecycle.ts";
import type { SnapshotStore } from "../snapshots.ts";
import {
  defaultAutoResetRule,
  type AccountEventDetail,
  type AutoResetRule,
} from "../automation-schemas.ts";
import { ActionsDisabledError, type ActionService } from "./actions.ts";

/**
 * Evaluates one account's auto-reset rule (ADR 0003). The rule is a standing owner action: it
 * needs the same "Allow Account Actions" gate as a button press, and it goes through
 * `ActionService.perform`. Any throw is for the caller to catch.
 *
 * - `evaluate` runs after a scheduled collection that succeeded: a spent limit. It never retries.
 * - `beforeExpiry` runs on every scheduler tick: a banked reset about to expire unused. It retries;
 *   `wantsReading` tells the scheduler when to take the fresh reading each try needs.
 */

export interface AutoResetServiceOptions {
  readonly automation: Pick<AutomationStore, "autoReset">;
  readonly connections: Pick<ConnectionStore, "get">;
  readonly snapshots: Pick<SnapshotStore, "latest" | "latestRun">;
  readonly actionRows: Pick<ActionStore, "automaticSince" | "latestRequestedAt">;
  readonly events: Pick<AccountEventStore, "record">;
  readonly actions: Pick<ActionService, "perform" | "enabled" | "supported">;
}

type SkipReason =
  | "no_rule"
  | "rule_disabled"
  | "expiry_disabled"
  | "actions_disabled"
  | "not_ready"
  | "unsupported"
  | "no_snapshot"
  | "no_window"
  | "no_credit"
  | "already_attempted"
  | "backing_off"
  | "no_fresh_reading";

export type AutoResetOutcome =
  | {
      readonly status: "fired";
      readonly state: "succeeded" | "failed" | "uncertain";
      /** The provider's Retry-After on a failed or unknown result, when it sent one. */
      readonly retryAfterMs?: number;
    }
  | { readonly status: "skipped"; readonly reason: SkipReason };

type Latest = NonNullable<ReturnType<SnapshotStore["latest"]>>;
type Skipped = Extract<AutoResetOutcome, { status: "skipped" }>;

const hourMs = 3_600_000;
const weeklyMinSeconds = 7 * 86_400;
const sessionMaxSeconds = 5 * 3_600;
const windowScope = /^window:(\d+)s$/;
/** The wait after the first use-before-expiry try; it doubles after each further one. */
export const expiryRetryBaseMs = 30_000;
/** A reading this recent counts as fresh for a use-before-expiry attempt. */
export const expiryFreshMs = 60_000;

function watches(rule: AutoResetRule, seconds: number): boolean {
  const weekly = seconds >= weeklyMinSeconds;
  const session = seconds <= sessionMaxSeconds;
  if (rule.window === "weekly") return weekly;
  if (rule.window === "session") return session;
  return weekly || session;
}

/** The known account-wide limit windows in a reading, longest first. Model-specific limits are left out. */
function limitWindows(
  latest: Latest,
): { key: string; seconds: number; percent: number; resetsAt: number }[] {
  return latest.metrics
    .flatMap((metric) => {
      if (!metric.providerMetricKey.startsWith("rate_limit.")) return [];
      if (metric.kind !== "quota_percentage" || metric.availability !== "available") return [];
      const seconds = Number(windowScope.exec(metric.scope)?.[1]);
      if (!Number.isFinite(seconds) || seconds <= 0) return [];
      if (metric.valueNum === null || metric.resetsAt === null) return [];
      return [
        {
          key: metric.providerMetricKey,
          seconds,
          percent: metric.valueNum,
          resetsAt: metric.resetsAt.getTime(),
        },
      ];
    })
    .toSorted((a, b) => b.seconds - a.seconds);
}

export class AutoResetService {
  /**
   * Use-before-expiry tries per `connectionId:creditId`. A try counts whether the action ran, threw
   * or had no fresh reading, so a provider that is down is not read on every tick. Kept in memory:
   * a restart allows one early try.
   */
  private readonly tries = new Map<string, { count: number; at: number; notBefore: number }>();

  constructor(private readonly deps: AutoResetServiceOptions) {}

  async evaluate(connectionId: string, now: number): Promise<AutoResetOutcome> {
    const rule = this.deps.automation.autoReset(connectionId);
    if (!rule) return { status: "skipped", reason: "no_rule" };
    if (!rule.enabled) return { status: "skipped", reason: "rule_disabled" };
    const latest = this.ready(connectionId);
    if ("status" in latest) return latest;

    // Longest window first: a weekly limit outranks a session limit when both qualify.
    const candidates = limitWindows(latest).filter(
      (window) =>
        watches(rule, window.seconds) &&
        window.percent >= rule.thresholdPercent &&
        window.resetsAt - now > rule.minHoursLeft * hourMs,
    );
    if (candidates.length === 0) return { status: "skipped", reason: "no_window" };

    const credit = latest.resetCredits
      .filter((c) => c.usable)
      .toSorted(
        (a, b) =>
          (a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY),
      )[0];
    if (!credit) return { status: "skipped", reason: "no_credit" };

    // One automatic attempt per window instance, which runs from resetsAt minus the window length.
    // An attempt inside any qualifying window blocks, so a failed weekly attempt is not retried on
    // every 5-hour window while the weekly limit stays spent. Use-before-expiry rows have their own origin.
    const attempted = candidates.some(
      (candidate) =>
        this.deps.actionRows.automaticSince(
          connectionId,
          new Date(candidate.resetsAt - candidate.seconds * 1000),
        ).length > 0,
    );
    const window = candidates[0];
    if (attempted || !window) return { status: "skipped", reason: "already_attempted" };

    return this.fire(connectionId, now, credit.providerCreditId, window.key, {
      percent: window.percent,
      resetsAt: window.resetsAt,
    });
  }

  /**
   * True when a use-before-expiry try is due and the latest reading is not fresh. The scheduler
   * then collects the account, within its own Retry-After rules, before it calls `beforeExpiry`.
   */
  wantsReading(connectionId: string, now: number): boolean {
    const found = this.expiring(connectionId, now);
    return (
      !("status" in found) &&
      !this.backingOff(found.key, now) &&
      !this.fresh(connectionId, found.key, now)
    );
  }

  /**
   * Uses a usable banked reset that expires within the rule's lead time, whatever the limits show.
   * An account with no stored rule uses the default, which has this trigger on. Each try needs a
   * reading from the last minute, taken after the previous try and after the account's newest
   * action, that still lists the credit as usable inside the lead time: a credit that left the
   * inventory was used, and an unconfirmed attempt may have applied. After a try, the next waits
   * `expiryRetryBaseMs`, doubling each time, or longer when the provider sent a Retry-After.
   */
  async beforeExpiry(connectionId: string, now: number): Promise<AutoResetOutcome> {
    const found = this.expiring(connectionId, now);
    if ("status" in found) return found;
    if (this.backingOff(found.key, now)) return { status: "skipped", reason: "backing_off" };
    for (const [key, entry] of this.tries) if (now - entry.at > hourMs) this.tries.delete(key);
    // Checked before this try is recorded: the reading must postdate the previous one.
    const fresh = this.fresh(connectionId, found.key, now);
    // Recorded before the call, so a throw still counts as a try.
    const entry = { count: (this.tries.get(found.key)?.count ?? 0) + 1, at: now, notBefore: 0 };
    this.tries.set(found.key, entry);
    if (!fresh) return { status: "skipped", reason: "no_fresh_reading" };

    const window = limitWindows(found.latest)[0];
    const outcome = await this.fire(connectionId, now, found.creditId, window?.key ?? null, {
      percent: window?.percent ?? null,
      resetsAt: window?.resetsAt ?? null,
      trigger: "expiry",
      creditExpiresAt: found.expiresAt,
    });
    if (outcome.status === "fired" && outcome.retryAfterMs !== undefined)
      entry.notBefore = now + outcome.retryAfterMs;
    return outcome;
  }

  /** The gates every trigger shares. Returns the latest reading, or why the rule cannot act. */
  private ready(connectionId: string): Latest | Skipped {
    if (!this.deps.actions.enabled) return { status: "skipped", reason: "actions_disabled" };
    const connection = this.deps.connections.get(connectionId);
    if (!connection || (connection.state !== "ready" && connection.state !== "partial"))
      return { status: "skipped", reason: "not_ready" };
    if (!this.deps.actions.supported(connection.provider).includes("consume_reset_credit"))
      return { status: "skipped", reason: "unsupported" };
    return this.deps.snapshots.latest(connectionId) ?? { status: "skipped", reason: "no_snapshot" };
  }

  /** The usable credit that expires first inside the lead time, in the latest reading. */
  private expiring(
    connectionId: string,
    now: number,
  ): { latest: Latest; creditId: string; expiresAt: number; key: string } | Skipped {
    const rule = this.deps.automation.autoReset(connectionId) ?? defaultAutoResetRule;
    if (!rule.beforeExpiry) return { status: "skipped", reason: "expiry_disabled" };
    const latest = this.ready(connectionId);
    if ("status" in latest) return latest;
    const leadMs = rule.beforeExpiryMinutes * 60_000;
    const credit = latest.resetCredits
      .flatMap((c) => {
        const expiresAt = c.expiresAt?.getTime();
        if (!c.usable || expiresAt === undefined || expiresAt <= now) return [];
        return expiresAt - now <= leadMs ? [{ creditId: c.providerCreditId, expiresAt }] : [];
      })
      .toSorted((a, b) => a.expiresAt - b.expiresAt)[0];
    if (!credit) return { status: "skipped", reason: "no_credit" };
    return { latest, ...credit, key: `${connectionId}:${credit.creditId}` };
  }

  private backingOff(key: string, now: number): boolean {
    const last = this.tries.get(key);
    if (last === undefined) return false;
    return now < Math.max(last.at + expiryRetryBaseMs * 2 ** (last.count - 1), last.notBefore);
  }

  /**
   * The latest collection succeeded within `expiryFreshMs`, and finished after the previous try for
   * this credit and after the account's newest action of any origin, so it shows their effect.
   */
  private fresh(connectionId: string, key: string, now: number): boolean {
    const run = this.deps.snapshots.latestRun(connectionId);
    const finishedAt = run?.finishedAt?.getTime();
    const ok = run?.outcome === "succeeded" || run?.outcome === "partial";
    if (!ok || finishedAt === undefined || now - finishedAt > expiryFreshMs) return false;
    const lastAction = this.deps.actionRows.latestRequestedAt(connectionId)?.getTime() ?? 0;
    return finishedAt > Math.max(this.tries.get(key)?.at ?? 0, lastAction);
  }

  private async fire(
    connectionId: string,
    now: number,
    creditId: string,
    metricKey: string | null,
    extra: Pick<
      Extract<AccountEventDetail, { kind: "auto_reset" }>,
      "percent" | "resetsAt" | "trigger" | "creditExpiresAt"
    >,
  ): Promise<AutoResetOutcome> {
    let outcome;
    try {
      outcome = await this.deps.actions.perform({
        connectionId,
        action: "consume_reset_credit",
        creditId,
        confirm: true,
        // Its own origin, so a use before expiry is not the limit trigger's one attempt per window.
        origin: extra.trigger === "expiry" ? "expiry" : "automation",
      });
    } catch (error) {
      if (error instanceof ActionsDisabledError)
        return { status: "skipped", reason: "actions_disabled" };
      throw error;
    }
    const state = outcome.action.state;
    const retryAfter =
      outcome.retryAfterMs === undefined ? {} : { retryAfterMs: outcome.retryAfterMs };
    if (state !== "succeeded" && state !== "failed" && state !== "uncertain")
      return { status: "fired", state: "uncertain", ...retryAfter };
    this.deps.events.record(connectionId, now, metricKey, {
      kind: "auto_reset",
      actionId: outcome.action.id,
      state,
      creditId,
      ...extra,
    });
    return { status: "fired", state, ...retryAfter };
  }
}
