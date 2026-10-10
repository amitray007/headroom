/**
 * Every URL, header and constant the Grok connector uses. Sources: docs/providers/grok.md,
 * OpenUsage's Grok client (source-inspected) and the pinned Grok CLI (validated headless).
 * The OpenUsage license is in THIRD_PARTY_NOTICES.md.
 */

export const billingUrl = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
export const settingsUrl = "https://cli-chat-proxy.grok.com/v1/settings";
export const tokenUrl = "https://auth.x.ai/oauth2/token";

/** OIDC client id the CLI stores in its auth file; used only when the file omits it. */
export const defaultClientId = "b1a00492-073a-47ea-816f-4c329264a828";

export function apiHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
    "user-agent": "Headroom",
    "x-xai-token-auth": "xai-grok-cli",
  };
}

/** The pinned official CLI, its headless login command, and the file it writes under $GROK_HOME. */
export const cli = {
  command: ["grok", "login", "--device-auth"],
  homeVariable: "GROK_HOME",
  credentialFile: "auth.json",
  timeoutMs: 15 * 60 * 1000,
} as const;
