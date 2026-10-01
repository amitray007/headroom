/**
 * Every URL, header and constant the Antigravity connector uses. Sources: docs/providers/antigravity.md,
 * CLIProxyAPI internal/auth/antigravity (source-inspected) and OpenUsage's Antigravity client.
 *
 * The OAuth client is Google's "installed application" type for Antigravity. Google documents that
 * installed-app client secrets are not confidential; both reference projects ship these values.
 */
export const clientId = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export const clientSecret = "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";
/** The client's registered loopback redirect. A remote browser lands here and the user pastes the URL back. */
export const redirectUri = "http://localhost:51121/oauth-callback";
export const scopes = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

export const authUrl = "https://accounts.google.com/o/oauth2/v2/auth";
export const tokenUrl = "https://oauth2.googleapis.com/token";
export const userInfoUrl = "https://www.googleapis.com/oauth2/v2/userinfo?alt=json";

/** Cloud Code hosts, tried in order; OpenUsage does the same. */
export const cloudCodeHosts = [
  "https://daily-cloudcode-pa.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
];
/**
 * Needs `{ project }` with the account's Cloud AI Companion project from `loadCodeAssist`.
 * Validated 2026-10-01: an empty body answers 403 "You do not have a valid license of this product".
 */
export const quotaSummaryPath = "/v1internal:retrieveUserQuotaSummary";
export const loadCodeAssistPath = "/v1internal:loadCodeAssist";
/** Client metadata `loadCodeAssist` expects; the values CLIProxyAPI sends for Antigravity. */
export const loadCodeAssistBody = {
  metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
} as const;

export function cloudCodeHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": "antigravity",
  };
}

/** Bucket ids the quota summary is known to carry, with the window each represents. */
export const knownBuckets: Readonly<Record<string, { scope: string; label: string }>> = {
  "gemini-5h": { scope: "window:18000s", label: "Gemini five-hour" },
  "gemini-weekly": { scope: "window:604800s", label: "Gemini weekly" },
  "3p-5h": { scope: "window:18000s", label: "Claude and GPT five-hour" },
  "3p-weekly": { scope: "window:604800s", label: "Claude and GPT weekly" },
};
