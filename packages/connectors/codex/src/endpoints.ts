/**
 * Every URL, header and constant the Codex connector uses. Nothing else in the
 * connector may name a provider endpoint. Sources: docs/providers/codex.md.
 */

/** Public OAuth client id of the Codex CLI; needed for token refresh. Source-inspected in CLIProxyAPI. */
export const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";

export const tokenUrl = "https://auth.openai.com/oauth/token";
export const usageUrl = "https://chatgpt.com/backend-api/wham/usage";
export const resetCreditsUrl = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
/**
 * Consumes one earned reset credit. Source-inspected in CLI 0.159.3 next to the read
 * route; the app-server call that fronts it takes creditId, creditType and idempotencyKey. Body
 * field names below are the serde names found in the binary (`credit_type` with the variants
 * `usage_limit` and `credits`). Unvalidated: the owner runs the first real consume from the dashboard.
 */
export const consumeResetCreditUrl = `${resetCreditsUrl}/consume`;
export function consumeResetCreditBody(creditId: string, idempotencyKey: string): string {
  return JSON.stringify({
    credit_id: creditId,
    credit_type: "usage_limit",
    idempotency_key: idempotencyKey,
  });
}

/** Headers the official clients send; the reset-credits route expects the desktop originator. */
export function usageHeaders(
  accessToken: string,
  accountId: string | null,
): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
    "user-agent": "Headroom",
    ...(accountId ? { "chatgpt-account-id": accountId } : {}),
  };
}

export function resetCreditsHeaders(
  accessToken: string,
  accountId: string | null,
): Record<string, string> {
  return {
    ...usageHeaders(accessToken, accountId),
    "openai-beta": "codex-1",
    originator: "Codex Desktop",
  };
}

/** The official CLI, its headless login command, and the file it writes. */
export const cli = {
  command: ["codex", "login", "--device-auth"],
  homeVariable: "CODEX_HOME",
  credentialFile: "auth.json",
  /** The CLI says the one-time code expires in fifteen minutes. */
  timeoutMs: 15 * 60 * 1000,
} as const;
