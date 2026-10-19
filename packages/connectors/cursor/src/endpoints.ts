/**
 * Every URL and header the Cursor member connector uses. Sources: docs/providers/cursor.md and
 * pi-cursor's auth and usage modules (MIT, source-inspected; the login flow is ported, not imported,
 * because the package exports only its pi extension surface). The pi-cursor and OpenUsage licenses
 * are in THIRD_PARTY_NOTICES.md.
 */
export const loginUrl = "https://cursor.com/loginDeepControl";
export const pollUrl = "https://api2.cursor.sh/auth/poll";
export const refreshUrl = "https://api2.cursor.sh/auth/exchange_user_api_key";
export const usageUrl = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
/** Grok Bot ("Sand" inside Cursor): its own weekly allowance on the same account. Route from OpenUsage (source-inspected). */
export const grokBotUsageUrl =
  "https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus";

/** The plan and how often its included usage resets: weekly on The X Subscription plans (validated 2026-10-20). */
export const planInfoUrl = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo";
/** Enterprise and team seats get no `planUsage` from the RPC above; this web route carries their plan. Route from OpenUsage; validated 2026-10-19. */
export const usageSummaryUrl = "https://cursor.com/api/usage-summary";

export function rpcHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "connect-protocol-version": "1",
    "user-agent": "Headroom",
  };
}

/**
 * The cursor.com web routes take the access token as a session cookie: the user id (the token subject after any
 * `provider|` prefix), a URL-encoded `::`, then the token. This is how OpenUsage builds it.
 */
export function webSessionHeaders(subject: string, accessToken: string): Record<string, string> {
  const userId = subject.includes("|") ? subject.slice(subject.indexOf("|") + 1) : subject;
  return {
    cookie: `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}`,
    accept: "application/json",
    "user-agent": "Headroom",
  };
}
