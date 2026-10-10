/**
 * Every URL, header and constant the Copilot connector uses. Sources: docs/providers/copilot.md,
 * the gh CLI source for the public OAuth client id, and OpenUsage's Copilot client for headers.
 * The OpenUsage license is in THIRD_PARTY_NOTICES.md.
 */

/** Public OAuth App client id of the GitHub CLI (cli/cli internal/authflow/flow.go). */
export const clientId = "178c6fc778ccc68e1d6a";
/** Least privilege: identity only. The usage endpoint needs a user token, not repository access. */
export const scope = "read:user";

export const deviceCodeUrl = "https://github.com/login/device/code";
export const accessTokenUrl = "https://github.com/login/oauth/access_token";
export const userUrl = "https://api.github.com/user";
export const usageUrl = "https://api.github.com/copilot_internal/user";

/** Headers the official Copilot clients send; the endpoint expects the `token` scheme and an editor identity. */
export function usageHeaders(token: string): Record<string, string> {
  return {
    authorization: `token ${token}`,
    accept: "application/json",
    "editor-version": "vscode/1.96.2",
    "editor-plugin-version": "copilot-chat/0.26.7",
    "user-agent": "GitHubCopilotChat/0.26.7",
    "x-github-api-version": "2025-04-01",
  };
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "Headroom",
  };
}
