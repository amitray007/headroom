import type { AccountEventStore } from "../account-events.ts";
import type { ActionStore } from "../actions.ts";
import type { AutomationStore } from "../automation.ts";
import type { ConnectionStore } from "../lifecycle.ts";
import type { SnapshotStore } from "../snapshots.ts";
import type { AutoResetRule } from "../automation-schemas.ts";
import { ActionsDisabledError, type ActionService } from "./actions.ts";

/**
 * Evaluates one account's auto-reset rule (ADR 0003). The scheduler calls it after a collection
 * that succeeded. The rule is a standing owner action: it needs the same "Allow Account Actions"
 * gate as a button press, and it goes through `ActionService.perform` with `origin: "automation"`.
 * Any throw is for the caller to catch; nothing here retries.
 */

export interface AutoResetServiceOptions {
  readonly automation: Pick<AutomationStore, "autoReset">;
  readonly connections: Pick<ConnectionStore, "get">;
  readonly snapshots: Pick<SnapshotStore, "latest">;
  readonly actionRows: Pick<ActionStore, "automaticSince">;
  readonly events: Pick<AccountEventStore, "record">;
  readonly actions: Pick<ActionService, "perform" | "enabled" | "supported">;
}

export type AutoResetOutcome =
  | { readonly status: "fired"; readonly state: "succeeded" | "failed" | "uncertain" }
  | {
      readonly status: "skipped";
      readonly reason:
        | "no_rule"
        | "rule_disabled"
        | "actions_disabled"
        | "not_ready"
        | "unsupported"
        | "no_snapshot"
        | "no_window"
        | "no_credit"
        | "already_attempted";
    };

const hourMs = 3_600_000;
const weeklyMinSeconds = 7 * 86_400;
const sessionMaxSeconds = 5 * 3_600;
const windowScope = /^window:(\d+)s$/;

function watches(rule: AutoResetRule, seconds: number): boolean {
  const weekly = seconds >= weeklyMinSeconds;
  const session = seconds <= sessionMaxSeconds;
  if (rule.window === "weekly") return weekly;
  if (rule.window === "session") return session;
  return weekly || session;
}

export class AutoResetService {
  constructor(private readonly deps: AutoResetServiceOptions) {}

  async evaluate(connectionId: string, now: number): Promise<AutoResetOutcome> {
    const rule = this.deps.automation.autoReset(connectionId);
    if (!rule) return { status: "skipped", reason: "no_rule" };
    if (!rule.enabled) return { status: "skipped", reason: "rule_disabled" };
    if (!this.deps.actions.enabled) return { status: "skipped", reason: "actions_disabled" };
    const connection = this.deps.connections.get(connectionId);
    if (!connection || (connection.state !== "ready" && connection.state !== "partial"))
      return { status: "skipped", reason: "not_ready" };
    if (!this.deps.actions.supported(connection.provider).includes("consume_reset_credit"))
      return { status: "skipped", reason: "unsupported" };
    const latest = this.deps.snapshots.latest(connectionId);
    if (!latest) return { status: "skipped", reason: "no_snapshot" };

    // Longest window first: a weekly limit outranks a session limit when both qualify.
    const candidates = latest.metrics
      .flatMap((metric) => {
        if (!metric.providerMetricKey.startsWith("rate_limit.")) return [];
        if (metric.kind !== "quota_percentage" || metric.availability !== "available") return [];
        const seconds = Number(windowScope.exec(metric.scope)?.[1]);
        if (!Number.isFinite(seconds) || seconds <= 0 || !watches(rule, seconds)) return [];
        if (metric.valueNum === null || metric.resetsAt === null) return [];
        if (metric.valueNum < rule.thresholdPercent) return [];
        if (metric.resetsAt.getTime() - now <= rule.minHoursLeft * hourMs) return [];
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
    const window = candidates.find(
      (candidate) =>
        this.deps.actionRows.automaticSince(
          connectionId,
          new Date(candidate.resetsAt - candidate.seconds * 1000),
        ).length === 0,
    );
    if (!window) return { status: "skipped", reason: "already_attempted" };

    let outcome;
    try {
      outcome = await this.deps.actions.perform({
        connectionId,
        action: "consume_reset_credit",
        creditId: credit.providerCreditId,
        confirm: true,
        origin: "automation",
      });
    } catch (error) {
      if (error instanceof ActionsDisabledError)
        return { status: "skipped", reason: "actions_disabled" };
      throw error;
    }
    const state = outcome.action.state;
    if (state !== "succeeded" && state !== "failed" && state !== "uncertain")
      return { status: "fired", state: "uncertain" };
    this.deps.events.record(connectionId, now, window.key, {
      kind: "auto_reset",
      actionId: outcome.action.id,
      state,
      creditId: credit.providerCreditId,
      percent: window.percent,
      resetsAt: window.resetsAt,
    });
    return { status: "fired", state };
  }
}
