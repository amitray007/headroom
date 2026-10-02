import type { AttemptState, AuthMethod } from "@headroom/core/contracts";

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

/** The method a new attempt starts with: the first one that is not a file import. */
export function defaultMethod(methods: readonly AuthMethod[]): AuthMethod | null {
  return methods.find((method) => method !== "import") ?? methods[0] ?? null;
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
  expired: "The approval expired before it was confirmed. Nothing was saved.",
  cancelled: "The sign-in was cancelled. Nothing was saved.",
  failed:
    "The provider rejected the sign-in. Nothing was saved. Check that you used the right account and try again.",
} as const;

/** Plain words for each category of failure the server reports as "category: detail". */
const categoryReasons: Record<string, string> = {
  approval_expired: stoppedReasons.expired,
  approval_denied: "The sign-in was declined at the provider. Nothing was saved.",
  authentication_required: stoppedReasons.failed,
  permission_denied:
    "This account is not allowed to share its limits. Nothing was saved. Try an account with access.",
  rate_limited:
    "The provider asked Headroom to slow down. Nothing was saved. Try again in a minute.",
  provider_unavailable: "The provider did not answer. Nothing was saved. Try again in a minute.",
  identity_mismatch:
    "This sign-in is for a different account than the one being reconnected. Nothing was saved.",
  invalid_response:
    "The provider sent something Headroom could not read. Nothing was saved. Check what you pasted and try again.",
  unsupported_metric:
    "The provider does not report any limits for this account. Nothing was saved.",
  selection_required: "An account has to be chosen first. Nothing was saved.",
  internal_error: "Headroom hit a problem while checking the sign-in. Nothing was saved.",
};

/** Plain words for why an attempt did not finish. Never shows the raw category or provider text. */
export function stoppedReason(attempt: Pick<Attempt, "state" | "error">): string {
  if (attempt.state === "expired") return stoppedReasons.expired;
  if (attempt.state === "cancelled") return stoppedReasons.cancelled;
  const category = attempt.error?.split(":")[0]?.trim() ?? "";
  return categoryReasons[category] ?? stoppedReasons.failed;
}
