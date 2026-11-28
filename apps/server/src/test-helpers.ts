import { baseUrl, type Connector, crypto, loadConfig } from "@headroom/core";

import { type AppContext, bootstrap } from "./bootstrap.ts";
import type { DeriveNotifications } from "./notify/dispatcher.ts";
import type { Fetch } from "./notify/http.ts";

/** Tests never reach the network: a call nobody stubbed fails like an offline host. */
const offline: Fetch = () => Promise.reject(new TypeError("fetch failed: tests are offline"));

/** The install ID and watermark in memory, so no test writes to a real data directory. */
function memoryTelemetryState() {
  let watermark: number | null = null;
  return {
    installId: () => "test-install",
    watermark: { read: () => watermark, write: (at: number) => void (watermark = at) },
  };
}

/** In-memory context with throwaway secrets; never touches the filesystem. */
export function testContext(
  env: Record<string, string> = {},
  options: {
    rateLimit?: boolean;
    connectors?: readonly Connector[];
    now?: () => Date;
    fetch?: Fetch;
    derive?: DeriveNotifications;
    /** The PostHog project key. Empty by default, so nothing is sent. */
    telemetryKey?: string;
  } = {},
): AppContext {
  return bootstrap({
    config: loadConfig(env),
    databasePath: ":memory:",
    keyring: crypto.createKeyring({ 1: crypto.parseKeyHex(crypto.generateKeyHex()) }),
    authSecret: crypto.generateKeyHex(),
    rateLimit: options.rateLimit ?? false,
    telemetryKey: options.telemetryKey ?? "",
    telemetryState: memoryTelemetryState(),
    connectors: options.connectors ?? [],
    ...(options.now ? { now: options.now } : {}),
    fetch: options.fetch ?? offline,
    ...(options.derive ? { derive: options.derive } : {}),
  });
}

/** Absolute URL on the context's base origin, which Better Auth needs to match. */
export function url(ctx: AppContext, path: string): string {
  return `${baseUrl(ctx.config)}${path}`;
}

/** Collect every Set-Cookie pair into one Cookie header value. */
export function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0] ?? "")
    .filter((pair) => pair.length > 0)
    .join("; ");
}

export const owner = {
  name: "Owner",
  email: "owner@example.com",
  username: "owner",
  password: "correct horse battery",
};

export function jsonPost(
  ctx: AppContext,
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl(ctx.config), ...headers },
    body: JSON.stringify(body),
  };
}

/** Sign the owner up and return a Cookie header for authenticated requests. */
export async function signedIn(
  ctx: AppContext,
  app: { request: (input: string, init?: RequestInit) => Response | Promise<Response> },
): Promise<string> {
  const response = await app.request(url(ctx, "/api/auth/sign-up/email"), jsonPost(ctx, owner));
  return cookiesFrom(response);
}
