import type { NotificationDeliveryFailure } from "@headroom/core";

import { version } from "../version.ts";

/** The slice of `fetch` the senders use. Tests inject a fake; production passes the global. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type SendResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly failure: NotificationDeliveryFailure;
      /** Seconds the receiver asked us to wait, when it said so (Telegram 429). */
      readonly retryAfterSeconds?: number;
    };

const requestTimeoutMs = 10_000;
const userAgent = `Headroom/${version}`;

/**
 * One outgoing POST: 10 second timeout, redirects are never followed, fixed user agent.
 * Throws nothing; a transport problem comes back as `timeout` or `network`. No error text
 * is kept, because it could echo the URL, which can hold a secret.
 */
export async function post(
  fetchFn: Fetch,
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<Response | "timeout" | "network"> {
  try {
    return await fetchFn(url, {
      method: "POST",
      headers: { "user-agent": userAgent, ...headers },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "timeout"
      : "network";
  }
}

/** Failure class for a non-2xx status. A 3xx counts as rejected: a redirect is never followed. */
export function failureForStatus(status: number): NotificationDeliveryFailure {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "rejected";
}
