import { ConnectorError } from "./connector.ts";

/** Minimal fetch shape so connectors and their tests can substitute a stub without casts. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * A provider request that has not answered by now is dead. The scheduler is serial and a collection
 * lease lasts two minutes, so a hung request must end well inside one lease.
 */
export const defaultFetchTimeoutMs = 20_000;

/**
 * `fetch` with a hard timeout, combined with any signal the caller passes. A timeout becomes a transient
 * `provider_unavailable`; a caller's own abort propagates unchanged.
 */
export function timeoutFetch(
  base: FetchLike = (input, init) => fetch(input, init),
  timeoutMs: number = defaultFetchTimeoutMs,
): FetchLike {
  return async (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const caller = init?.signal ?? undefined;
    const signal = caller ? AbortSignal.any([caller, timeout]) : timeout;
    try {
      return await base(input, { ...init, signal });
    } catch (error) {
      if (timeout.aborted && !caller?.aborted)
        throw new ConnectorError("provider_unavailable", "the provider request timed out");
      throw error;
    }
  };
}

const minRetryMs = 60_000;
const maxRetryMs = 60 * 60_000;

/**
 * How long to wait before asking again. Reads `Retry-After` as delta-seconds or an HTTP date and clamps it
 * to one minute..one hour; a missing or unreadable header gives `fallbackMs`.
 */
export function retryAfterMs(
  response: Response,
  fallbackMs: number = minRetryMs,
  now: number = Date.now(),
): number {
  const header = response.headers.get("retry-after")?.trim();
  if (!header) return fallbackMs;
  const waitMs = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(waitMs)) return fallbackMs;
  return Math.min(maxRetryMs, Math.max(minRetryMs, waitMs));
}

export interface ThrowForStatusOptions {
  /**
   * Some providers answer 403 for a secondary rate limit. Return true when this 403 is one; it becomes
   * `rate_limited` instead of `permission_denied`.
   */
  readonly forbiddenIsRateLimit?: (response: Response) => boolean;
}

/** Turn a non-2xx response into the matching `ConnectorError`. The message carries the status only, never the body. */
export function throwForStatus(
  response: Response,
  what: string,
  options: ThrowForStatusOptions = {},
): void {
  if (response.ok) return;
  if (response.status === 401)
    throw new ConnectorError("authentication_required", `${what} returned 401`);
  if (response.status === 403) {
    if (options.forbiddenIsRateLimit?.(response))
      throw new ConnectorError("rate_limited", `${what} rate limited`, retryAfterMs(response));
    throw new ConnectorError("permission_denied", `${what} returned 403`);
  }
  if (response.status === 429)
    throw new ConnectorError("rate_limited", `${what} returned 429`, retryAfterMs(response));
  if (response.status >= 500)
    throw new ConnectorError("provider_unavailable", `${what} returned ${response.status}`);
  throw new ConnectorError("invalid_response", `${what} returned ${response.status}`);
}
