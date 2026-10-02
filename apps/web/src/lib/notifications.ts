import type { Provider } from "@headroom/core/contracts";

import type { OverviewConnection, Settings } from "../api.ts";
import { accountName, providerName, refreshFailed } from "./labels.ts";
import { presentPanel } from "./present.ts";
import { resolveWhen, shortDate } from "./time.ts";
import { toneOf } from "./tone.ts";

/**
 * Notifications are derived from the latest overview and the owner's settings. Nothing is stored
 * on the server. Only which ones the owner has read is kept, in this browser.
 */

type NotificationTone = "bad" | "warn" | "info";
type NotificationKind =
  | "almost_out"
  | "running_low"
  | "reset_expiring"
  | "refresh_failed"
  | "disconnected";

export interface AppNotification {
  /** Stable while the situation lasts and new for the next period, so a repeat appears again. */
  readonly id: string;
  readonly connectionId: string;
  readonly provider: Provider;
  readonly account: string;
  readonly kind: NotificationKind;
  readonly tone: NotificationTone;
  readonly title: string;
  readonly description: string;
  /** When it happened or was observed, for an age label. */
  readonly at: number;
}

const day = 86_400_000;
const expiryWindowMs = 3 * day;

const allOn: Settings["notifications"] = {
  runningLow: true,
  expiringResets: true,
  refreshFailures: true,
};

type NotificationSettings = Pick<
  Settings,
  "limitsView" | "lowThresholdPercent" | "timeStyle" | "clock"
> & { notifications: Settings["notifications"] };

function limitNotifications(
  connection: OverviewConnection,
  settings: NotificationSettings,
  now: number,
): AppNotification[] {
  const snapshot = connection.snapshot;
  if (snapshot === null) return [];
  const name = providerName(connection.provider);
  const found: AppNotification[] = [];
  for (const cell of presentPanel(connection).cells) {
    if (cell.kind !== "meter" || cell.used === null || cell.unlimited) continue;
    const tone = toneOf(cell.used, settings.lowThresholdPercent);
    if (tone === null || tone === "good") continue;
    const out = tone === "bad";
    const kind = out ? "almost_out" : "running_low";
    const shownPercent = Math.round(
      settings.limitsView === "left" ? Math.max(0, 100 - cell.used) : cell.used,
    );
    const share = `${shownPercent}${settings.limitsView === "left" ? "% left" : "% used"}.`;
    let reset = "";
    if (cell.resetsAt !== null) {
      const { lead, text } = resolveWhen("until", cell.resetsAt, now, settings);
      reset = ` Resets ${lead === "" ? "" : `${lead} `}${text}.`;
    }
    found.push({
      id: `${connection.id}:${kind}:${cell.key}:${cell.resetsAt ?? ""}`,
      connectionId: connection.id,
      provider: connection.provider,
      account: accountName(connection),
      kind,
      tone: out ? "bad" : "warn",
      title: out
        ? `${name} Is Almost Out of Its ${cell.short} Limit`
        : `${name} ${cell.short} Limit Is Running Low`,
      description: `${share}${reset}`,
      at: snapshot.observedAt,
    });
  }
  return found;
}

function expiryNotifications(connection: OverviewConnection, now: number): AppNotification[] {
  const snapshot = connection.snapshot;
  if (snapshot === null) return [];
  const banked = snapshot.resetCredits.filter((credit) => credit.usable);
  const soon = banked
    .filter(
      (credit) =>
        credit.expiresAt !== null &&
        credit.expiresAt > now &&
        credit.expiresAt - now <= expiryWindowMs,
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
      id: `${connection.id}:reset_expiring:${first.providerCreditId}:${first.expiresAt}`,
      connectionId: connection.id,
      provider: connection.provider,
      account: accountName(connection),
      kind: "reset_expiring",
      tone: "info",
      title: `A ${providerName(connection.provider)} Reset Expires in ${days} ${days === 1 ? "Day" : "Days"}`,
      description: `${soon.length} of ${banked.length} banked full resets ${verb}.`,
      at: snapshot.observedAt,
    },
  ];
}

function failureNotifications(connection: OverviewConnection): AppNotification[] {
  const name = providerName(connection.provider);
  // A failure lasts until the next success, so its id carries the last success, not the run.
  const since = connection.lastSuccessAt ?? connection.createdAt;
  const base = {
    connectionId: connection.id,
    provider: connection.provider,
    account: accountName(connection),
  };
  if (connection.state === "reconnect_required") {
    return [
      {
        ...base,
        id: `${connection.id}:disconnected:${connection.reconnectReason ?? ""}:${since}`,
        kind: "disconnected",
        tone: "bad",
        title: `${name} Is Disconnected`,
        description: "The sign-in for this account has expired. Reconnect to keep tracking it.",
        at: connection.latestRun?.finishedAt ?? connection.latestRun?.startedAt ?? since,
      },
    ];
  }
  const run = connection.latestRun;
  if (connection.state === "paused" || run === null || !refreshFailed(run)) return [];
  return [
    {
      ...base,
      id: `${connection.id}:refresh_failed::${since}`,
      kind: "refresh_failed",
      tone: "warn",
      title: `${name} Refresh Failed`,
      description: "Headroom could not refresh this account. It will try again in a few minutes.",
      at: run.finishedAt ?? run.startedAt,
    },
  ];
}

const toneRank: Record<NotificationTone, number> = { bad: 0, warn: 1, info: 2 };

export function deriveNotifications(
  connections: readonly OverviewConnection[],
  settings: NotificationSettings,
  now: number,
): AppNotification[] {
  const found: AppNotification[] = [];
  for (const connection of connections) {
    const live = connection.state === "ready" || connection.state === "partial";
    if (live && settings.notifications.runningLow) {
      found.push(...limitNotifications(connection, settings, now));
    }
    if (live && settings.notifications.expiringResets) {
      found.push(...expiryNotifications(connection, now));
    }
    if (settings.notifications.refreshFailures) found.push(...failureNotifications(connection));
  }
  return found.toSorted(
    (a, b) => toneRank[a.tone] - toneRank[b.tone] || b.at - a.at || a.id.localeCompare(b.id),
  );
}

/** Every id that exists now, whatever the owner switched off, so read marks survive a toggle. */
export function currentIds(
  connections: readonly OverviewConnection[],
  settings: NotificationSettings,
  now: number,
): Set<string> {
  const all = { ...settings, notifications: allOn };
  return new Set(deriveNotifications(connections, all, now).map((item) => item.id));
}

// ---------- read state ----------

export const readKey = "headroom.notifications.read";

export function loadRead(storage: Pick<Storage, "getItem">): Set<string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(readKey) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveRead(storage: Pick<Storage, "setItem">, read: ReadonlySet<string>): void {
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
