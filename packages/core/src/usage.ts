/** Shared by the server and the web app for the anonymous usage stats (ADR 0007). */

/** Dashboard pages the web app reports when the owner opens them. */
export const usageViews = [
  "overview",
  "detailed",
  "compare",
  "timeline",
  "wallet",
  "analytics",
  "connect",
] as const;
export type UsageView = (typeof usageViews)[number];

/** Longest feedback message, in characters. */
export const feedbackMaxLength = 2000;
