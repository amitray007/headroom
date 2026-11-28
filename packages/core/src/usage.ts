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

/** Where the web app caught an error it reports: a render failure, an uncaught error or an unhandled rejection. */
export const webErrorPlaces = ["render", "window", "promise"] as const;
export type WebErrorPlace = (typeof webErrorPlaces)[number];

/** Owner presses the web app reports, such as opening the release notes from the update notice. */
export const usageActions = ["update_opened"] as const;
export type UsageAction = (typeof usageActions)[number];
