/**
 * Every URL, header and constant the Claude connector uses. Sources: docs/providers/claude.md,
 * CLIProxyAPI and OpenUsage (source-inspected), and the pinned Claude Code CLI (validated headless).
 * This connector is off by default (D16); the owner enables it knowingly.
 */

/** Public OAuth client id of Claude Code; needed for token refresh. Source-inspected in CLIProxyAPI and OpenUsage. */
export const clientId = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const scopes =
  "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

export const tokenUrl = "https://platform.claude.com/v1/oauth/token";
export const profileUrl = "https://api.anthropic.com/api/oauth/profile";
/** `cedar_ember=1` asks for the reset-grant block alongside the usage windows. */
export const usageUrl = "https://api.anthropic.com/api/oauth/usage?cedar_ember=1";

/**
 * The claude.ai organization's usage-credit balance: purchased and promotional tranches with expiry. Claude Code
 * reads it for `/usage-credits`. Answers 403 "only available for Pro and Max plans" for other organizations,
 * including a Console organization, so it never shows Console API credits. Validated 2026-10-08.
 */
export function prepaidCreditsUrl(organizationUuid: string): string {
  return `https://api.anthropic.com/api/oauth/organizations/${encodeURIComponent(organizationUuid)}/prepaid/credits`;
}

/**
 * Client identity sent to the OAuth endpoints. The usage endpoint withholds the reset-grant block
 * (`cedar_ember.eligible: false`, `ineligible_reason: "surface"`) unless the user agent looks like the
 * Claude Code CLI, and it enforces a version floor (`ineligible_reason: "cli_version"`). Bump this
 * to a current Claude Code release if Anthropic raises the floor. Validated 2026-10-02.
 */
export const claudeCodeUserAgent = "claude-cli/2.1.285 (external, cli)";

export function oauthHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
    "content-type": "application/json",
    "anthropic-beta": "oauth-2025-04-20",
    "user-agent": claudeCodeUserAgent,
  };
}

/** The pinned official CLI, its headless login command, and the file it writes under $CLAUDE_CONFIG_DIR. */
export const cli = {
  command: ["claude", "auth", "login"],
  homeVariable: "CLAUDE_CONFIG_DIR",
  credentialFile: ".credentials.json",
  timeoutMs: 15 * 60 * 1000,
} as const;
