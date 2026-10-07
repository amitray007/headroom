import {
  kindSwitches,
  type AccountEvent,
  type NotificationAmountUnit,
  type NotificationEvent,
  type NotificationKind,
  type Provider,
} from "@headroom/core/contracts";

import type { Metric, OverviewConnection } from "./overview.ts";
import { meterWindows, type MeterWindow } from "./accounts.ts";
import { spendLabel } from "./automation.ts";
import { accountName, providerName, refreshFailed } from "./labels.ts";
import { formatNumber, formatUsd } from "./present.ts";
import { resolveWhen, shortDate } from "./time.ts";
import { dayLabel, isoDate } from "./wallet-dates.ts";
import { toneOf } from "./tone.ts";

/**
 * Notifications are derived from the latest overview and the owner's settings. Nothing is stored
 * on the server. Only which ones the owner has read is kept, in this browser. Each one is a
 * `NotificationEvent`, the same shape the server will later deliver (docs/architecture/notifications.md).
 */

export type AppNotification = NotificationEvent;
type NotificationTone = AppNotification["tone"];

const day = 86_400_000;

const everything: NotificationPreferences = {
  kinds: kindSwitches(true),
  includeSessions: true,
  resetLeadDays: 7,
  mutedProviders: [],
};

/** The preferences that choose which events fire. */
export type NotificationPreferences = {
  /** One switch per kind. A kind that is off never fires, whatever else is set. */
  readonly kinds: Readonly<Record<NotificationKind, boolean>>;
  readonly includeSessions: boolean;
  readonly resetLeadDays: 1 | 3 | 7;
  readonly mutedProviders: readonly Provider[];
};

/**
 * The part of the owner's settings the derivation reads. The web `Settings` and the server's core
 * `Settings` both fit this shape.
 */
export type NotificationSettings = {
  readonly limitsView: "used" | "left";
  readonly lowThresholdPercent: 30 | 20 | 15;
  readonly timeStyle: "countdown" | "exact";
  readonly clock: "24h" | "12h";
  readonly notifications: NotificationPreferences;
};

function base(
  connection: OverviewConnection,
  observedAt: number,
): Pick<AppNotification, "schemaVersion" | "provider" | "connection" | "observedAt" | "links"> {
  return {
    schemaVersion: 1,
    provider: connection.provider,
    connection: { id: connection.id, name: accountName(connection), plan: connection.plan },
    observedAt,
    links: {},
  };
}

function shareText(used: number, view: NotificationSettings["limitsView"]): string {
  const shown = Math.round(view === "left" ? Math.max(0, 100 - used) : used);
  return `${shown}${view === "left" ? "% left" : "% used"}.`;
}

// ---------- limits ----------

interface Candidate {
  readonly window: MeterWindow;
  readonly used: number;
  readonly tone: NotificationTone;
  readonly event: AppNotification;
}

/** A model-scoped weekly window, such as Weekly Fable. */
function isScopedWeekly(provider: Provider, key: string): boolean {
  return provider === "claude" && (key.startsWith("limits.") || key === "seven_day_sonnet");
}

/**
 * Claude reports the weekly all-models limit and model limits that overlap it. When both are low the same
 * way, one notice is enough: keep the tighter. Different tones both stay, since one is worse than the other.
 */
function withoutOverlap(connection: OverviewConnection, found: Candidate[]): Candidate[] {
  if (connection.provider !== "claude") return found;
  const all = found.find((item) => item.window.key === "seven_day");
  if (all === undefined) return found;
  const dropped = new Set<string>();
  for (const item of found) {
    if (!isScopedWeekly(connection.provider, item.window.key) || item.tone !== all.tone) continue;
    dropped.add(item.used > all.used ? all.window.key : item.window.key);
  }
  return found.filter((item) => !dropped.has(item.window.key));
}

function limitNotifications(
  connection: OverviewConnection,
  settings: NotificationSettings,
  now: number,
): AppNotification[] {
  const snapshot = connection.snapshot;
  if (snapshot === null) return [];
  const name = providerName(connection.provider);
  const found: Candidate[] = [];
  for (const window of meterWindows(connection)) {
    const used = window.used;
    if (used === null || window.unlimited) continue;
    if (!settings.notifications.includeSessions && window.kind === "session") continue;
    const tone = toneOf(used, settings.lowThresholdPercent);
    if (tone === null || tone === "good") continue;
    const out = tone === "bad";
    const kind = out ? "almost_out" : "running_low";
    let reset = "";
    if (window.resetsAt !== null) {
      const { lead, text } = resolveWhen("until", window.resetsAt, now, settings);
      reset = ` Resets ${lead === "" ? "" : `${lead} `}${text}.`;
    }
    found.push({
      window,
      used,
      tone: out ? "bad" : "warn",
      event: {
        ...base(connection, snapshot.observedAt),
        id: `${connection.id}:${kind}:${window.key}:${window.resetsAt ?? ""}`,
        kind,
        tone: out ? "bad" : "warn",
        occurredAt: snapshot.observedAt,
        subject: { metricKey: window.key, label: window.label, window: window.window },
        figures: {
          percentUsed: used,
          percentLeft: Math.max(0, 100 - used),
          ...(window.resetsAt === null ? {} : { resetsAt: window.resetsAt }),
        },
        title: out
          ? `${name} Is Almost Out of Its ${window.short} Limit`
          : `${name} ${window.short} Limit Is Running Low`,
        message: `${shareText(used, settings.limitsView)}${reset}`,
      },
    });
  }
  return withoutOverlap(connection, found).map((item) => item.event);
}

// ---------- banked resets ----------

function expiryNotifications(
  connection: OverviewConnection,
  settings: NotificationSettings,
  now: number,
): AppNotification[] {
  const snapshot = connection.snapshot;
  if (snapshot === null) return [];
  const lead = settings.notifications.resetLeadDays * day;
  const banked = snapshot.resetCredits.filter((credit) => credit.usable);
  const soon = banked
    .filter(
      (credit) =>
        credit.expiresAt !== null && credit.expiresAt > now && credit.expiresAt - now <= lead,
    )
    .toSorted((a, b) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0));
  const first = soon[0];
  if (first === undefined || first.expiresAt === null) return [];
  const days = Math.ceil((first.expiresAt - now) / day);
  const verb =
    soon.length === 1
      ? `expires ${shortDate(first.expiresAt)}`
      : `expire from ${shortDate(first.expiresAt)}`;
  return [
    {
      ...base(connection, snapshot.observedAt),
      id: `${connection.id}:reset_expiring:${first.providerCreditId}:${first.expiresAt}`,
      kind: "reset_expiring",
      tone: "info",
      occurredAt: snapshot.observedAt,
      subject: { metricKey: null, label: "Banked Resets", window: null },
      figures: { expiresAt: first.expiresAt },
      title: `A ${providerName(connection.provider)} Reset Expires in ${days} ${days === 1 ? "Day" : "Days"}`,
      message: `${soon.length} of ${banked.length} banked full resets ${verb}.`,
    },
  ];
}

// ---------- balances and spend ----------

function metricOf(connection: OverviewConnection, key: string): Metric | null {
  return connection.snapshot?.metrics.find((metric) => metric.providerMetricKey === key) ?? null;
}

/** A reported number. Unavailable, unlimited and unknown values are null, never zero. */
function numberOf(metric: Metric | null): number | null {
  if (metric === null || metric.availability !== "available" || metric.unlimited === true)
    return null;
  return metric.valueNum;
}

/** The metric that carries the period a spend or count belongs to, where the spend itself has no reset. */
const periodAnchors: Partial<Record<Provider, string>> = {
  cursor: "included.total_percent",
  grok: "weekly_pool.used_percent",
  copilot: "credits.used_percent",
};

/** When the period ends if known, and a key that changes with each period. */
function periodOf(
  connection: OverviewConnection,
  metric: Metric,
): { readonly key: string; readonly resetsAt: number | null } {
  const anchorKey = periodAnchors[connection.provider];
  const anchor = anchorKey === undefined ? null : metricOf(connection, anchorKey);
  const end = metric.resetsAt ?? metric.windowEnd ?? anchor?.resetsAt ?? anchor?.windowEnd ?? null;
  if (end !== null) return { key: String(end), resetsAt: end };
  // A monthly figure with no reset time: the calendar month it was read in.
  const observed = connection.snapshot?.observedAt ?? 0;
  return { key: new Date(observed).toISOString().slice(0, 7), resetsAt: null };
}

function balanceNotifications(
  connection: OverviewConnection,
  settings: NotificationSettings,
): AppNotification[] {
  const snapshot = connection.snapshot;
  if (connection.provider !== "vercel_ai_gateway" || snapshot === null) return [];
  const balance = numberOf(metricOf(connection, "credits.balance"));
  const spent = numberOf(metricOf(connection, "credits.total_used"));
  // Without a known total there is nothing to measure the balance against.
  if (balance === null || spent === null || balance + spent <= 0) return [];
  const total = balance + spent;
  const left = (balance / total) * 100;
  const tone = toneOf(100 - left, settings.lowThresholdPercent);
  if (tone === null || tone === "good") return [];
  const out = tone === "bad";
  const unit = "gateway_credits";
  return [
    {
      ...base(connection, snapshot.observedAt),
      // The total granted changes with a top-up, which starts a new notice.
      id: `${connection.id}:balance_low:credits.balance:${total.toFixed(2)}:${tone}`,
      kind: "balance_low",
      tone: out ? "bad" : "warn",
      occurredAt: snapshot.observedAt,
      subject: { metricKey: "credits.balance", label: "Credit Balance", window: null },
      figures: {
        percentUsed: 100 - left,
        percentLeft: left,
        amount: { value: balance, unit },
        cap: { value: total, unit },
      },
      title: out
        ? `${providerName(connection.provider)} Credits Are Almost Out`
        : `${providerName(connection.provider)} Credits Are Running Low`,
      message: `${shareText(100 - left, settings.limitsView)} ${formatNumber(balance, 2)} of ${formatNumber(total, 2)} credits remain.`,
    },
  ];
}

interface SpendPair {
  readonly used: string;
  readonly cap: string;
  readonly label: string;
  readonly unit: NotificationAmountUnit;
  /** The cap must describe the same scope as the spend. */
  readonly sameScope: boolean;
}

const spendPairs: Partial<Record<Provider, SpendPair>> = {
  claude: {
    used: "extra_usage.used",
    cap: "extra_usage.monthly_limit",
    label: "Extra Usage",
    unit: "USD",
    sameScope: false,
  },
  cursor: {
    used: "on_demand.used",
    cap: "on_demand.limit",
    label: "On-Demand Spend",
    unit: "USD",
    sameScope: true,
  },
  grok: {
    used: "on_demand.used",
    cap: "on_demand_cap",
    label: "On-Demand Use",
    unit: "grok_credits",
    sameScope: false,
  },
};

function amountText(value: number, unit: NotificationAmountUnit): string {
  return unit === "USD" ? formatUsd(value) : formatNumber(value, Number.isInteger(value) ? 0 : 2);
}

function spendNotifications(
  connection: OverviewConnection,
  settings: NotificationSettings,
): AppNotification[] {
  const snapshot = connection.snapshot;
  const pair = spendPairs[connection.provider];
  if (pair === undefined || snapshot === null) return [];
  const spendMetric = metricOf(connection, pair.used);
  const capMetric = metricOf(connection, pair.cap);
  const used = numberOf(spendMetric);
  const cap = numberOf(capMetric);
  if (spendMetric === null || capMetric === null || used === null || cap === null) return [];
  // A cap of zero means off, not a limit already reached.
  if (cap <= 0 || (pair.sameScope && spendMetric.scope !== capMetric.scope)) return [];
  const share = (used / cap) * 100;
  if (share < 100 - settings.lowThresholdPercent) return [];
  const reached = share >= 100;
  const kind = reached ? "spend_cap_reached" : "spend_near_cap";
  const period = periodOf(connection, spendMetric);
  const name = providerName(connection.provider);
  const words = pair.unit === "USD" ? "spent" : "credits used";
  return [
    {
      ...base(connection, snapshot.observedAt),
      id: `${connection.id}:${kind}:${pair.used}:${period.key}`,
      kind,
      tone: reached ? "bad" : "warn",
      occurredAt: snapshot.observedAt,
      subject: { metricKey: pair.used, label: pair.label, window: null },
      figures: {
        percentUsed: share,
        percentLeft: Math.max(0, 100 - share),
        amount: { value: used, unit: pair.unit },
        cap: { value: cap, unit: pair.unit },
        ...(period.resetsAt === null ? {} : { resetsAt: period.resetsAt }),
      },
      title: reached
        ? `${name} ${pair.label} Has Reached Its Cap`
        : `${name} ${pair.label} Is Near Its Cap`,
      message: `${amountText(used, pair.unit)} of ${amountText(cap, pair.unit)} ${words}.`,
    },
  ];
}

/** Where use beyond the plan starts to count: a count for Copilot, an amount of spend for the rest. */
interface ExtraUsageSource {
  readonly key: string;
  readonly label: string;
  readonly unit: NotificationAmountUnit;
  readonly title: string;
}

const extraUsageSources: Partial<Record<Provider, ExtraUsageSource>> = {
  copilot: {
    key: "extra_usage.count",
    label: "Extra Usage",
    unit: "credits",
    title: "Extra Usage",
  },
  claude: { key: "extra_usage.used", label: "Extra Usage", unit: "USD", title: "Extra Usage" },
  cursor: {
    key: "on_demand.used",
    label: "On-Demand Spend",
    unit: "USD",
    title: "On-Demand Usage",
  },
  grok: {
    key: "on_demand.used",
    label: "On-Demand Use",
    unit: "grok_credits",
    title: "On-Demand Usage",
  },
};

/** "$12.00", "850 credits", "1 credit". Dollars only for USD; credits never carry a dollar sign. */
function figureText(value: number, unit: NotificationAmountUnit): string {
  if (unit === "USD") return formatUsd(value);
  return `${formatNumber(value, Number.isInteger(value) ? 0 : 2)} ${value === 1 ? "credit" : "credits"}`;
}

function extraUsageNotifications(connection: OverviewConnection): AppNotification[] {
  const snapshot = connection.snapshot;
  const source = extraUsageSources[connection.provider];
  if (source === undefined || snapshot === null) return [];
  const metric = metricOf(connection, source.key);
  const value = numberOf(metric);
  if (metric === null || value === null || value <= 0) return [];
  const period = periodOf(connection, metric);
  const copilot = connection.provider === "copilot";
  return [
    {
      ...base(connection, snapshot.observedAt),
      id: `${connection.id}:extra_usage_started:${source.key}:${period.key}`,
      kind: "extra_usage_started",
      tone: "info",
      occurredAt: snapshot.observedAt,
      subject: {
        metricKey: source.key,
        label: source.label,
        window: copilot ? "monthly" : null,
      },
      figures: {
        amount: { value, unit: source.unit },
        ...(period.resetsAt === null ? {} : { resetsAt: period.resetsAt }),
      },
      title: `${providerName(connection.provider)} Has Started ${source.title}`,
      message: copilot
        ? `${formatNumber(value, Number.isInteger(value) ? 0 : 2)} extra ${value === 1 ? "credit" : "credits"} used this month.`
        : `${figureText(value, source.unit)} ${source.unit === "USD" ? "spent" : "used"} so far.`,
    },
  ];
}

// ---------- owner budgets ----------

function budgetNotifications(
  connection: OverviewConnection,
  settings: NotificationSettings,
): AppNotification[] {
  const snapshot = connection.snapshot;
  if (snapshot === null) return [];
  const found: AppNotification[] = [];
  for (const budget of connection.automation.budgets) {
    const metric = metricOf(connection, budget.metricKey);
    const used = numberOf(metric);
    if (metric === null || metric.kind !== "spend" || used === null || budget.amount <= 0) continue;
    const share = (used / budget.amount) * 100;
    if (share < 100 - settings.lowThresholdPercent) continue;
    const exceeded = share >= 100;
    const kind = exceeded ? "budget_exceeded" : "budget_near";
    const period = periodOf(connection, metric);
    const label = spendLabel(connection.provider, budget.metricKey);
    found.push({
      ...base(connection, snapshot.observedAt),
      id: `${connection.id}:${kind}:${budget.metricKey}:${period.key}:${budget.amount}`,
      kind,
      tone: exceeded ? "bad" : "warn",
      occurredAt: snapshot.observedAt,
      subject: { metricKey: budget.metricKey, label, window: null },
      figures: {
        percentUsed: share,
        percentLeft: Math.max(0, 100 - share),
        amount: { value: used, unit: budget.unit },
        cap: { value: budget.amount, unit: budget.unit },
        ...(period.resetsAt === null ? {} : { resetsAt: period.resetsAt }),
      },
      title: `${providerName(connection.provider)} ${label} ${exceeded ? "Is Over Your Budget" : "Is Near Your Budget"}`,
      message: `${figureText(used, budget.unit)} of your ${figureText(budget.amount, budget.unit)} budget ${budget.unit === "USD" ? "spent" : "used"}.`,
    });
  }
  return found;
}

// ---------- Wallet credits that expire ----------

/** A Wallet top-up with an expiry and an alert, as the derivation reads it. */
export interface ExpiringTopUp {
  readonly id: string;
  readonly connectionId: string;
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly credits: number | null;
  /** `YYYY-MM-DD`. */
  readonly expiresOn: string;
  readonly expiryAlertDays: number;
}

/** The top-ups that carry both an expiry and an alert, for `deriveNotifications`. */
export function expiringTopUps(
  topUps: readonly {
    readonly id: string;
    readonly connectionId: string;
    readonly date: string;
    readonly credits: number | null;
    readonly expiresOn: string | null;
    readonly expiryAlertDays: number | null;
  }[],
): ExpiringTopUp[] {
  return topUps.flatMap((topUp) =>
    topUp.expiresOn === null || topUp.expiryAlertDays === null
      ? []
      : [
          {
            id: topUp.id,
            connectionId: topUp.connectionId,
            date: topUp.date,
            credits: topUp.credits,
            expiresOn: topUp.expiresOn,
            expiryAlertDays: topUp.expiryAlertDays,
          },
        ],
  );
}

const creditUnits: Partial<Record<Provider, NotificationAmountUnit>> = {
  codex: "codex_credits",
  grok: "grok_credits",
  vercel_ai_gateway: "gateway_credits",
};

function expiringCreditNotifications(
  connection: OverviewConnection,
  topUps: readonly ExpiringTopUp[],
  now: number,
): AppNotification[] {
  const today = Date.parse(`${isoDate(now)}T00:00:00Z`);
  const found: AppNotification[] = [];
  for (const topUp of topUps) {
    if (topUp.connectionId !== connection.id) continue;
    const expires = Date.parse(`${topUp.expiresOn}T00:00:00Z`);
    if (!Number.isFinite(expires)) continue;
    const days = Math.round((expires - today) / day);
    // The expiry day itself still counts; the day after it does not.
    if (days < 0 || days > topUp.expiryAlertDays) continue;
    const unit = creditUnits[connection.provider];
    const credits =
      topUp.credits === null
        ? "Credits"
        : `${formatNumber(topUp.credits, Number.isInteger(topUp.credits) ? 0 : 2)} ${topUp.credits === 1 ? "credit" : "credits"}`;
    const occurredAt = expires - topUp.expiryAlertDays * day;
    const name = providerName(connection.provider);
    found.push({
      ...base(connection, connection.snapshot?.observedAt ?? occurredAt),
      id: `${connection.id}:credits_expiring:${topUp.id}:${topUp.expiresOn}`,
      kind: "credits_expiring",
      tone: "warn",
      occurredAt,
      subject: { metricKey: null, label: "Top-Up Credits", window: null },
      figures: {
        expiresAt: expires,
        ...(topUp.credits === null || unit === undefined
          ? {}
          : { amount: { value: topUp.credits, unit } }),
      },
      title:
        days === 0
          ? `${name} Credits Expire Today`
          : `${name} Credits Expire in ${days} ${days === 1 ? "Day" : "Days"}`,
      message: `${credits} from your ${dayLabel(topUp.date)} top-up ${days === 0 ? "expire today" : `expire ${dayLabel(topUp.expiresOn)}`}.`,
    });
  }
  return found;
}

// ---------- detected events ----------

/** An event stays a notice for this long after it happened. */
const eventLifetime = 72 * 3_600_000;

function eventBase(
  connection: OverviewConnection,
  event: AccountEvent,
  kind: AppNotification["kind"],
): Pick<
  AppNotification,
  | "schemaVersion"
  | "provider"
  | "connection"
  | "observedAt"
  | "links"
  | "id"
  | "kind"
  | "occurredAt"
> {
  return {
    ...base(connection, connection.snapshot?.observedAt ?? event.occurredAt),
    id: `${connection.id}:${kind}:${event.id}`,
    kind,
    occurredAt: event.occurredAt,
  };
}

function percentText(value: number): string {
  return `${Math.round(value)}%`;
}

function eventNotifications(
  connection: OverviewConnection,
  settings: NotificationSettings,
  now: number,
  muted: boolean,
  live: boolean,
): AppNotification[] {
  const on = settings.notifications;
  const name = providerName(connection.provider);
  const found: AppNotification[] = [];
  for (const event of connection.events) {
    if (now - event.occurredAt > eventLifetime) continue;
    const detail = event.detail;
    if (detail.kind === "auto_reset") {
      // A failed or uncertain attempt matters even for a muted provider or an account that stopped updating.
      const succeeded = detail.state === "succeeded";
      if (succeeded && (muted || !live)) continue;
      found.push({
        ...eventBase(connection, event, "auto_reset"),
        tone: succeeded ? "info" : "warn",
        subject: { metricKey: event.metricKey, label: "Auto-Reset", window: null },
        figures: { percentUsed: detail.percent },
        title: succeeded
          ? `${name} Auto-Reset Used a Banked Reset`
          : detail.state === "failed"
            ? `${name} Auto-Reset Failed`
            : `${name} Auto-Reset May Not Have Worked`,
        message: succeeded
          ? `A limit reached ${percentText(detail.percent)} used, so Headroom used a banked reset.`
          : detail.state === "failed"
            ? `A limit reached ${percentText(detail.percent)} used, but the reset did not go through. Headroom will not retry until the limit resets.`
            : `A limit reached ${percentText(detail.percent)} used, but Headroom could not confirm the reset. Check the account before you use another.`,
      });
      continue;
    }
    if (muted || !live) continue;
    if (detail.kind === "reset_granted") {
      const banked =
        detail.available === null
          ? ""
          : `${detail.available} banked ${detail.available === 1 ? "reset" : "resets"} available. `;
      const expires =
        detail.expiresAt === null
          ? "The new one has no expiry date."
          : `The new one expires ${shortDate(detail.expiresAt)}.`;
      found.push({
        ...eventBase(connection, event, "reset_granted"),
        tone: "info",
        subject: { metricKey: null, label: "Banked Resets", window: null },
        figures: detail.expiresAt === null ? {} : { expiresAt: detail.expiresAt },
        title: `${name} Banked a New Reset`,
        message: `${banked}${expires}`,
      });
    } else if (detail.kind === "early_reset") {
      const window = meterWindows(connection).find((item) => item.key === event.metricKey);
      if (!on.includeSessions && window?.kind === "session") continue;
      const left = Math.max(0, 100 - detail.percent);
      const spent = detail.bankedUsed === true ? " A banked reset was used outside Headroom." : "";
      found.push({
        ...eventBase(connection, event, "early_reset"),
        tone: "info",
        subject: {
          metricKey: event.metricKey,
          label: window?.label ?? event.metricKey,
          window: window?.window ?? null,
        },
        figures: { percentUsed: detail.percent, percentLeft: left },
        title: `${name} ${window?.short ?? event.metricKey ?? "Limit"} Limit Reset Early`,
        message:
          settings.limitsView === "left"
            ? `${percentText(left)} left, up from ${percentText(Math.max(0, 100 - detail.previousPercent))}, before its scheduled reset.${spent}`
            : `Usage fell from ${percentText(detail.previousPercent)} to ${percentText(detail.percent)} before its scheduled reset.${spent}`,
      });
    } else {
      found.push({
        ...eventBase(connection, event, "top_up_detected"),
        tone: "info",
        subject: { metricKey: event.metricKey, label: "Credit Balance", window: null },
        figures: { amount: { value: detail.added, unit: detail.unit } },
        title: `${name} Top-Up Detected`,
        message: `${figureText(detail.added, detail.unit)} added. The balance is now ${figureText(detail.current, detail.unit)}.`,
      });
    }
  }
  return found;
}

// ---------- sign-in and refresh ----------

function failureNotifications(connection: OverviewConnection, muted: boolean): AppNotification[] {
  const name = providerName(connection.provider);
  // A failure lasts until the next success, so its id carries the last success, not the run.
  const since = connection.lastSuccessAt ?? connection.createdAt;
  const observedAt = connection.snapshot?.observedAt ?? since;
  const shared = {
    ...base(connection, observedAt),
    subject: { metricKey: null, label: null, window: null },
    figures: {},
  };
  if (connection.state === "reconnect_required") {
    return [
      {
        ...shared,
        id: `${connection.id}:disconnected:${connection.reconnectReason ?? ""}:${since}`,
        kind: "disconnected",
        tone: "bad",
        occurredAt: connection.latestRun?.finishedAt ?? connection.latestRun?.startedAt ?? since,
        title: `${name} Is Disconnected`,
        message: "The sign-in for this account has expired. Reconnect to keep tracking it.",
      },
    ];
  }
  const run = connection.latestRun;
  // A muted provider still reports a broken sign-in, but not a refresh that will retry.
  // One failed run is a blip: notify only when the failure repeats.
  if (muted || connection.state === "paused" || run === null || !refreshFailed(run)) return [];
  if (run.failureStreak < 2) return [];
  return [
    {
      ...shared,
      id: `${connection.id}:refresh_failed::${since}`,
      kind: "refresh_failed",
      tone: "warn",
      occurredAt: run.finishedAt ?? run.startedAt,
      title: `${name} Refresh Failed`,
      message: "Headroom could not refresh this account. It will try again in a few minutes.",
    },
  ];
}

const toneRank: Record<NotificationTone, number> = { bad: 0, warn: 1, info: 2 };

export function deriveNotifications(
  connections: readonly OverviewConnection[],
  settings: NotificationSettings,
  now: number,
  topUps: readonly ExpiringTopUp[] = [],
): AppNotification[] {
  const found: AppNotification[] = [];
  const on = settings.notifications;
  for (const connection of connections) {
    const muted = on.mutedProviders.includes(connection.provider);
    const live = connection.state === "ready" || connection.state === "partial";
    if (live && !muted) {
      found.push(
        ...limitNotifications(connection, settings, now),
        ...expiryNotifications(connection, settings, now),
        ...balanceNotifications(connection, settings),
        ...spendNotifications(connection, settings),
        ...extraUsageNotifications(connection),
        ...budgetNotifications(connection, settings),
      );
    }
    if (!muted) found.push(...expiringCreditNotifications(connection, topUps, now));
    found.push(...eventNotifications(connection, settings, now, muted, live));
    found.push(...failureNotifications(connection, muted));
  }
  return found
    .filter((item) => on.kinds[item.kind])
    .toSorted(
      (a, b) =>
        toneRank[a.tone] - toneRank[b.tone] ||
        b.occurredAt - a.occurredAt ||
        a.id.localeCompare(b.id),
    );
}

/** Every id that exists now, whatever the owner switched off, so read marks survive a toggle. */
export function currentIds(
  connections: readonly OverviewConnection[],
  settings: NotificationSettings,
  now: number,
  topUps: readonly ExpiringTopUp[] = [],
): Set<string> {
  const all = { ...settings, notifications: everything };
  return new Set(deriveNotifications(connections, all, now, topUps).map((item) => item.id));
}

// ---------- read state ----------

export const readKey = "headroom.notifications.read";

export function loadRead(storage: { getItem(key: string): string | null }): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(readKey) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveRead(
  storage: { setItem(key: string, value: string): void },
  read: ReadonlySet<string>,
): void {
  storage.setItem(readKey, JSON.stringify([...read].toSorted()));
}

export function markRead(read: ReadonlySet<string>, id: string): Set<string> {
  return new Set(read).add(id);
}

export function markAllRead(
  read: ReadonlySet<string>,
  items: readonly { readonly id: string }[],
): Set<string> {
  return new Set([...read, ...items.map((item) => item.id)]);
}

/** Forget ids that no longer exist. */
export function pruneRead(read: ReadonlySet<string>, existing: ReadonlySet<string>): Set<string> {
  return new Set([...read].filter((id) => existing.has(id)));
}
