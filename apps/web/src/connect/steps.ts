import type { AttemptState, AuthMethod, MethodAvailability } from "@headroom/core/contracts";

import type { Attempt } from "../api.ts";

/** Attempt states after which nothing more can happen. */
export function isTerminal(state: AttemptState): boolean {
  return (
    state === "succeeded" || state === "failed" || state === "expired" || state === "cancelled"
  );
}

/** The page asks the server again after `pollAfterMs`, or while the owner has nothing to type. */
export function shouldPoll(attempt: Attempt): boolean {
  if (isTerminal(attempt.state)) return false;
  return (
    attempt.pollAfterMs > 0 ||
    attempt.state === "awaiting_user" ||
    attempt.state === "validating" ||
    attempt.state === "created"
  );
}

/** Whether the server can start `method` here. A method the server did not report on is usable. */
export function isUsable(method: AuthMethod, availability: readonly MethodAvailability[]): boolean {
  return availability.find((entry) => entry.method === method)?.available !== false;
}

/**
 * The method a new attempt starts with: the first usable one that is not a file import, else the
 * first usable one. Null when the server can start none of them.
 */
export function defaultMethod(
  methods: readonly AuthMethod[],
  availability: readonly MethodAvailability[] = [],
): AuthMethod | null {
  const usable = methods.filter((method) => isUsable(method, availability));
  return usable.find((method) => method !== "import") ?? usable[0] ?? null;
}

/** Plain words for a method the server cannot start. `provider` is the display name, as in "Codex". */
export function unavailableNote(
  provider: string,
  entry: MethodAvailability,
  alternatives: readonly AuthMethod[],
): string {
  const need =
    entry.reason === "cli_not_installed"
      ? `Needs the ${provider} CLI on the server.`
      : "Not available on this server.";
  if (alternatives.includes("import")) return `${need} Install it, or use Import.`;
  if (alternatives.length > 0) return `${need} Install it, or use another method.`;
  return `${need} Install it, then try again.`;
}

export type Accepts = "url" | "code" | "url_or_code";

/** Choose the submit kind for a pasted value; "url_or_code" decides by shape. */
export function pasteInputKind(accepts: Accepts, value: string): "redirect" | "code" {
  if (accepts === "url") return "redirect";
  if (accepts === "code") return "code";
  return /^https?:\/\//i.test(value.trim()) ? "redirect" : "code";
}

const acceptsLabels: Record<Accepts, string> = {
  url: "Address You Landed On",
  code: "Code Shown",
  url_or_code: "Address or Code",
};

export function acceptsLabel(accepts: Accepts): string {
  return acceptsLabels[accepts];
}

const acceptsPlaceholders: Record<Accepts, string> = {
  url: "http://localhost:…/callback?code=…",
  code: "Paste the code",
  url_or_code: "Paste the address or the code",
};

export function acceptsPlaceholder(accepts: Accepts): string {
  return acceptsPlaceholders[accepts];
}

/** "9:42" for the time left. Zero once it has passed. */
export function clockLeft(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const stoppedReasons = {
  expired: "The approval expired. Nothing was saved.",
  cancelled: "The sign-in was cancelled. Nothing was saved.",
  failed: "The provider rejected the sign-in. Nothing was saved. Check the account and try again.",
} as const;

/** Plain words for each category of failure the server reports as "category: detail". */
const categoryReasons: Record<string, string> = {
  approval_expired: stoppedReasons.expired,
  approval_denied: "The sign-in was declined. Nothing was saved.",
  authentication_required: stoppedReasons.failed,
  permission_denied: "This account cannot share its limits. Nothing was saved.",
  rate_limited: "The provider asked to slow down. Nothing was saved. Try again in a minute.",
  provider_unavailable: "The provider did not answer. Nothing was saved. Try again in a minute.",
  identity_mismatch:
    "This is a different account than the one being reconnected. Nothing was saved.",
  invalid_response:
    "The provider's reply was unreadable. Nothing was saved. Check what you pasted.",
  unsupported_metric: "The provider reports no limits for this account. Nothing was saved.",
  selection_required: "Choose an account first. Nothing was saved.",
  internal_error: "Something went wrong checking the sign-in. Nothing was saved.",
};

/** Plain words for why an attempt did not finish. Never shows the raw category or provider text. */
export function stoppedReason(attempt: Pick<Attempt, "state" | "error">): string {
  if (attempt.state === "expired") return stoppedReasons.expired;
  if (attempt.state === "cancelled") return stoppedReasons.cancelled;
  const category = attempt.error?.split(":")[0]?.trim() ?? "";
  return categoryReasons[category] ?? stoppedReasons.failed;
}
