import type { AuthMethod, ConnectionScope, Provider } from "@headroom/core/contracts";

import type { OverviewConnection } from "./overview.ts";

/** Default display order, as in the approved mockup. The owner's own order takes precedence. */
const defaultOrder: readonly Provider[] = [
  "claude",
  "codex",
  "cursor",
  "grok",
  "antigravity",
  "copilot",
  "vercel_ai_gateway",
];

const providerNames: Record<Provider, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  antigravity: "Antigravity",
  copilot: "Copilot",
  vercel_ai_gateway: "Vercel AI Gateway",
};

export function providerName(provider: Provider): string {
  return providerNames[provider];
}

/**
 * Connections grouped by provider, in `order` (providers it misses follow in the default order). Accounts keep
 * the order they came in, which the server has already sorted. Empty providers are left out.
 */
export function groupByProvider(
  connections: readonly OverviewConnection[],
  order: readonly Provider[] = defaultOrder,
): { provider: Provider; connections: OverviewConnection[] }[] {
  const ranked = [...order, ...defaultOrder.filter((provider) => !order.includes(provider))];
  return ranked
    .map((provider) => ({
      provider,
      connections: connections.filter((connection) => connection.provider === provider),
    }))
    .filter((group) => group.connections.length > 0);
}

const scopeNames: Record<ConnectionScope, string> = {
  individual: "Personal",
  member: "Work",
  team_admin: "Team",
  organization: "Team",
};

/** The owner's name for the account, else a word for its scope. Never "Member". */
export function accountName(connection: Pick<OverviewConnection, "name" | "scope">): string {
  const name = connection.name?.trim();
  return name ? name : scopeNames[connection.scope];
}

/** "pro" becomes "Pro"; "x_premium" becomes "X Premium". */
export function planLabel(plan: string | null): string | null {
  if (plan === null) return null;
  const words = plan
    .split(/[\s_-]+/)
    .filter((word) => word !== "")
    // Capitalise the first letter only, so a provider's own casing ("SuperGrok") survives.
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length === 0 ? null : words.join(" ");
}

const methodWords: Record<AuthMethod, string> = {
  cli_login: "Sign In",
  device_code: "Enter Code",
  paste_redirect: "Paste Address",
  approval_poll: "Approve in Browser",
  api_key: "API Key",
  import: "Import a File",
};

/** Short words for how a provider signs in, shown on its connect card. */
export function authMethodWords(method: AuthMethod): string {
  return methodWords[method];
}

type StatusTone = "good" | "warn" | "bad" | "quiet";
export interface StatusView {
  readonly word: "Active" | "Paused" | "Disconnected" | "Refresh Failed" | "Out of Date";
  readonly tone: StatusTone;
}

const healthyOutcomes = new Set(["succeeded", "partial"]);

/** The latest refresh ended in a failure. A run still in progress has no outcome and is not one. */
export function refreshFailed(run: OverviewConnection["latestRun"]): boolean {
  return run !== null && run.outcome !== null && !healthyOutcomes.has(run.outcome);
}

export function statusOf(
  connection: Pick<OverviewConnection, "state" | "latestRun" | "stale">,
): StatusView {
  if (connection.state === "reconnect_required") return { word: "Disconnected", tone: "bad" };
  if (connection.state === "paused") return { word: "Paused", tone: "quiet" };
  if (refreshFailed(connection.latestRun)) return { word: "Refresh Failed", tone: "warn" };
  if (connection.stale) return { word: "Out of Date", tone: "warn" };
  return { word: "Active", tone: "good" };
}
