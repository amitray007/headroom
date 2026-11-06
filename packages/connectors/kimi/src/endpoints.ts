import { release } from "node:os";

/** Source-inspected official client routes; see docs/providers/kimi.md. */
export const regions = {
  global: {
    baseUrl: "https://api.kimi.ai/coding/v1",
    oauthHost: "https://auth.kimi.ai",
    webBaseUrl: "https://www.kimi.ai",
    label: "Global (kimi.ai)",
  },
  "mainland-cn": {
    baseUrl: "https://api.kimi.com/coding/v1",
    oauthHost: "https://auth.kimi.com",
    webBaseUrl: "https://www.kimi.com",
    label: "Mainland China (kimi.com)",
  },
} as const;

export function apiHeaders(
  apiKey: string,
  identityHeaders: Record<string, string> = {},
): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    accept: "application/json",
    "user-agent": "Headroom",
    ...identityHeaders,
  };
}

export const clientId = "17e5f671-d194-4dfb-9706-5516cb48c098";
export const devicePath = "/api/oauth/device_authorization";
export const tokenPath = "/api/oauth/token";
export function deviceHeaders(deviceId: string, version: string): Record<string, string> {
  return {
    "x-msh-platform": "headroom",
    "x-msh-version": version,
    "x-msh-device-name": "Headroom",
    "x-msh-device-model": `${process.platform} ${process.arch}`,
    "x-msh-os-version": release().replace(/[^\x20-\x7e]/g, ""),
    "x-msh-device-id": deviceId,
    "user-agent": `Headroom/${version}`,
  };
}
