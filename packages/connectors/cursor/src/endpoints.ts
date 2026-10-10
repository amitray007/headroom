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

export function rpcHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "connect-protocol-version": "1",
    "user-agent": "Headroom",
  };
}
