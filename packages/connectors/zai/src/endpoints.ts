/** Source-inspected ZCode and z.ai console routes; see docs/providers/zai.md. */
export const quotaUrl = "https://api.z.ai/api/monitor/usage/quota/limit";
export const resetStatusUrl = "https://zcode.z.ai/api/v1/coding-plan/reset/status";
export function resetHeaders(zcodeToken: string, businessToken: string): Record<string, string> {
  return {
    ...jsonHeaders(),
    authorization: `Bearer ${zcodeToken}`,
    "X-Bigmodel-Authorization": businessToken,
    "Bigmodel-Target-Type": "PERSONAL",
  };
}
export const customerUrl = "https://api.z.ai/api/biz/customer/getCustomerInfo";
export const businessLoginUrl = "https://api.z.ai/api/auth/z/login";
export const initUrl = "https://zcode.z.ai/api/v1/oauth/cli/init";
export const pollBaseUrl = "https://zcode.z.ai/api/v1/oauth/cli/poll/";
export const approvalUrl = "https://chat.z.ai/api/oauth/authorize";
export const callbackUrl = "https://zcode.z.ai/api/v1/oauth/cli/callback/zai";
export const publicClientId = "client_P8X5CMWmlaRO9gyO-KSqtg";
export function jsonHeaders(): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "accept-language": "en-US,en",
  };
}
export function apiHeaders(token: string, session = false): Record<string, string> {
  return { ...jsonHeaders(), authorization: session ? `Bearer ${token}` : token };
}
