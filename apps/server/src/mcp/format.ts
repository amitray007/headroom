import type { z } from "zod";

import type { Provider } from "@headroom/core";
import type { AccountStory, PlanFit } from "@headroom/view-model/analytics";
import { type appFeedSchema, nextLimitBackOf } from "@headroom/view-model/app-feed";
import { age, countdown } from "@headroom/view-model/time";
import { formatMoney } from "@headroom/view-model/wallet-money";

type Feed = z.infer<typeof appFeedSchema>;
type FeedAccount = Feed["accounts"][number];
/** What the status text reads: the feed without its notices. */
type Status = Pick<Feed, "generatedAt" | "staleAfterMs" | "accounts" | "summary">;

type HistoryAccount = Pick<AccountStory, "id" | "provider" | "name" | "plan">;

/** The part of the Analytics model the history text needs. */
interface HistoryModel {
  readonly accounts: readonly HistoryAccount[];
  readonly history: { readonly coverageDays: number | null; readonly empty: boolean };
}

const stateWords: Record<FeedAccount["state"], string | null> = {
  ready: null,
  partial: "partial reading",
  reconnect_required: "reconnect required",
  paused: "paused",
};

function label(provider: Provider, name: string, plan: string | null): string {
  return `${provider} · ${name}${plan === null ? "" : ` (${plan})`}`;
}

const figure = (value: number): string => String(Math.round(value * 100) / 100);

/** "in 2 h 10 min", or null once the time has passed. */
function within(target: number, now: number): string | null {
  return target > now ? `in ${countdown(target, now).toLowerCase()}` : null;
}

/** Marks a private-interface metric on an account whose own interface is official. */
const privateMark = (metric: { interface: string }, account: FeedAccount): string =>
  metric.interface === "private" && account.interface !== "private" ? " (private)" : "";

function headerOf(account: FeedAccount, feed: Status): string {
  const parts = [label(account.provider, account.name, account.plan)];
  if (account.interface === "private") parts.push("private API");
  const state = stateWords[account.state];
  if (state !== null) {
    parts.push(account.reconnectReason === null ? state : `${state} (${account.reconnectReason})`);
  }
  const lastRead = account.observedAt ?? account.lastSuccessAt;
  const stale = lastRead !== null && feed.generatedAt - lastRead > feed.staleAfterMs;
  if (lastRead !== null && (state !== null || stale)) {
    parts.push(`last read ${age(lastRead, feed.generatedAt).toLowerCase()}`);
  }
  return parts.join(" · ");
}

function limitFacts(limit: FeedAccount["limits"][number], now: number): string {
  if (limit.unlimited) return "unlimited";
  if (limit.notStarted) return "not started";
  if (limit.percentLeft === null) return "unknown";
  const parts = [`${Math.round(limit.percentLeft)}% left`];
  if (limit.resetsAt !== null) {
    const cycle = limit.resetWords === "cycle_end";
    const reset = within(limit.resetsAt, now);
    parts.push(
      reset === null
        ? `${cycle ? "cycle ended" : "reset due"}, not read since`
        : `${cycle ? "cycle ends" : "resets"} ${reset}`,
    );
  }
  const runsOut = limit.runsOutAt === null ? null : within(limit.runsOutAt, now);
  if (runsOut !== null) parts.push(`runs out ${runsOut} at current pace`);
  return parts.join(", ");
}

function limitLine(limit: FeedAccount["limits"][number], account: FeedAccount, now: number) {
  return `${limit.label}${privateMark(limit, account)}: ${limitFacts(limit, now)}`;
}

function chargeFacts(charge: FeedAccount["charges"][number]): string {
  if (charge.unlimited) return "unlimited";
  if (charge.value === null) return "unknown";
  const cap = charge.cap === null ? "" : ` of ${figure(charge.cap.value)} ${charge.cap.unit} cap`;
  return `${figure(charge.value)} ${charge.unit}${cap}`;
}

function chargeLine(charge: FeedAccount["charges"][number], account: FeedAccount): string {
  return `${charge.label}${privateMark(charge, account)}: ${chargeFacts(charge)}`;
}

function bankedLine(banked: NonNullable<FeedAccount["banked"]>, now: number): string | null {
  if (banked.count === null) return `banked: unknown ${banked.unit}`;
  if (banked.count === 0) return null;
  const next = banked.expiries.filter((at) => at > now).toSorted((a, b) => a - b)[0];
  const expiry = next === undefined ? "" : `, next expires ${within(next, now)}`;
  return `banked: ${figure(banked.count)} ${banked.unit}${expiry}`;
}

function accountBlock(account: FeedAccount, feed: Status): string[] {
  const now = feed.generatedAt;
  const banked = account.banked === null ? null : bankedLine(account.banked, now);
  return [
    headerOf(account, feed),
    ...account.limits.map((limit) => limitLine(limit, account, now)),
    ...account.charges.map((charge) => chargeLine(charge, account)),
    ...(banked === null ? [] : [banked]),
  ].map((line, index) => (index === 0 ? line : `  ${line}`));
}

/** One text block per account, listing only the facts that are not defaults. */
export function formatStatus(feed: Status, provider?: Provider): string {
  const accounts = feed.accounts.filter(
    (account) => provider === undefined || account.provider === provider,
  );
  if (accounts.length === 0)
    return provider === undefined ? "no accounts" : `no ${provider} accounts`;
  const lines = accounts.flatMap((account) => accountBlock(account, feed));
  const total = feed.summary.monthlyPlanTotal;
  if (provider === undefined && total !== null) lines.push(`plans: ${formatMoney(total)}/month`);
  // The summary's next limit can belong to a filtered-out provider; work it out from the shown accounts.
  const back =
    provider === undefined
      ? feed.summary.nextLimitBack
      : nextLimitBackOf(accounts, feed.generatedAt);
  const backAccount =
    back === null ? undefined : accounts.find((account) => account.id === back.accountId);
  const backIn = back === null ? null : within(back.at, feed.generatedAt);
  if (back !== null && backAccount !== undefined && backIn !== null) {
    const limit = backAccount.limits.find((item) => item.key === back.metricKey);
    lines.push(`next limit back: ${backAccount.name} ${limit?.label ?? back.metricKey} ${backIn}`);
  }
  return lines.join("\n");
}

const unitWords = { week: "weekly", month: "monthly", window: "window" } as const;
const verdictWords: Record<PlanFit["verdict"], string> = {
  too_small: "too small",
  fits: "fits",
  room_to_spare: "room to spare",
  thin: "not enough history",
};

function fitSummary(story: HistoryAccount, fit: PlanFit | null): string[] {
  const head = label(story.provider, story.name, story.plan);
  if (fit === null) return [`${head}: no closed windows yet`];
  const parts = [
    `${fit.windows.length} ${fit.windows.length === 1 ? "window" : "windows"}`,
    `avg peak ${Math.round(fit.average)}%`,
    `max ${Math.round(fit.highest)}%`,
  ];
  if (fit.hits > 0) parts.push(`hit limit ${fit.hits}x (${Math.round(fit.lockedHours)} h locked)`);
  parts.push(`fit: ${verdictWords[fit.verdict]}`);
  if (fit.unusedUsd !== null) parts.push(`~$${Math.round(fit.unusedUsd)}/month unused`);
  const peaks = fit.windows.map(
    (window) => `${Math.round(window.peak)}${window.hit ? "!" : ""}${window.early ? "↺" : ""}`,
  );
  return [`${head} ${unitWords[fit.unit]}: ${parts.join(", ")}`, `  peaks: ${peaks.join(" ")}`];
}

/** `fits` holds each account's plan fit, keyed by account id. */
export function formatHistory(
  analytics: HistoryModel,
  fits: ReadonlyMap<string, PlanFit | null>,
  days: number,
  provider?: Provider,
): string {
  if (analytics.accounts.length === 0) {
    return `no active ${provider === undefined ? "" : `${provider} `}accounts with percentage limits`;
  }
  const coverage = analytics.history.coverageDays;
  const first =
    analytics.history.empty || coverage === null
      ? `last ${days} days, no history yet`
      : `last ${days} days, history covers ${Math.max(1, Math.round(coverage))} days`;
  const blocks = analytics.accounts.flatMap((story) =>
    fitSummary(story, fits.get(story.id) ?? null),
  );
  const windows = analytics.accounts.flatMap((story) => fits.get(story.id)?.windows ?? []);
  const legend = [
    windows.some((window) => window.hit) ? "! hit the limit" : null,
    windows.some((window) => window.early) ? "↺ reset early" : null,
  ].filter((item) => item !== null);
  return [first, ...(legend.length > 0 ? [`marks: ${legend.join(", ")}`] : []), ...blocks].join(
    "\n",
  );
}
