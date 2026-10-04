import { ConnectorError } from "./connector.ts";

/** Minimal fetch shape so connectors and their tests can substitute a stub without casts. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * A provider request that has not answered by now is dead. The scheduler is serial and a collection
 * lease lasts two minutes, so a hung request must end well inside one lease.
 */
export const defaultFetchTimeoutMs = 20_000;

/** Most redirects one request may follow. Provider endpoints answer directly; a long chain is a fault. */
export const maxRedirects = 5;

/**
 * Headers that carry a credential or identify the account: `authorization`, `cookie`, `x-api-key`,
 * `x-xai-token-auth`, `chatgpt-account-id` and the like. They never cross to another origin.
 */
const credentialHeader = /auth|cookie|token|secret|session|key|account/i;

/** Headers that describe a request body; they go with the body when a redirect turns the request into a GET. */
const bodyHeaders = ["content-type", "content-length", "content-encoding", "content-language"];

/** The parts of a request a redirect may change. `init` wins over a `Request`'s own fields, as in `new Request(input, init)`. */
interface Hop {
  url: URL;
  method: string;
  headers: Headers;
  body: RequestInit["body"];
}

function firstHop(input: string | URL | Request, init: RequestInit | undefined): Hop {
  const request = input instanceof Request ? input : undefined;
  return {
    url: new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url),
    method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
    headers: new Headers(init?.headers ?? request?.headers),
    // A Request body is a one-shot stream; replaying it across a 307/308 is refused below.
    body: init?.body ?? request?.body ?? null,
  };
}

/**
 * The request to send after `response` redirected `hop`, following the fetch spec: 303 becomes GET, and
 * 301/302 turn a POST into a GET; both drop the body. A cross-origin hop drops credential headers, and a
 * hop from https to http is refused so a token never goes out in clear text.
 */
function nextHop(hop: Hop, response: Response, location: string): Hop {
  let target: URL;
  try {
    target = new URL(location, hop.url);
  } catch {
    throw new ConnectorError("invalid_response", "the provider sent an unreadable redirect");
  }
  if (hop.url.protocol === "https:" && target.protocol !== "https:")
    throw new ConnectorError("invalid_response", "the provider redirected from https to http");
  if (target.protocol !== "https:" && target.protocol !== "http:")
    throw new ConnectorError(
      "invalid_response",
      "the provider redirected to an unsupported scheme",
    );
  const next: Hop = { ...hop, url: target, headers: new Headers(hop.headers) };
  const toGet =
    response.status === 303
      ? hop.method !== "HEAD"
      : (response.status === 301 || response.status === 302) && hop.method === "POST";
  if (toGet) {
    next.method = "GET";
    next.body = null;
    for (const name of bodyHeaders) next.headers.delete(name);
  } else if (hop.body instanceof ReadableStream) {
    throw new ConnectorError(
      "invalid_response",
      "a streamed request body cannot follow a redirect",
    );
  }
  if (target.origin !== hop.url.origin) {
    // Collect first: deleting while iterating a Headers object skips entries.
    const credentials = Array.from(next.headers.keys()).filter((name) =>
      credentialHeader.test(name),
    );
    for (const name of credentials) next.headers.delete(name);
  }
  return next;
}

/**
 * `fetch` with a hard timeout, combined with any signal the caller passes. A timeout becomes a transient
 * `provider_unavailable`; a caller's own abort propagates unchanged.
 *
 * Redirects are followed here, not by `fetch`, so a hop to another origin cannot carry the provider
 * credential with it (see `nextHop`). One timeout covers the whole chain.
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
      // A caller that asks for manual handling gets the raw 3xx response, as with plain fetch.
      if (init?.redirect === "manual" || init?.redirect === "error")
        return await base(input, { ...init, signal });
      let hop = firstHop(input, init);
      for (let followed = 0; ; followed++) {
        // The first hop sends the caller's request untouched; later hops send the rebuilt one.
        // eslint-disable-next-line no-await-in-loop -- each hop depends on the previous response
        const response = await (followed === 0
          ? base(input, { ...init, redirect: "manual", signal })
          : base(hop.url.href, {
              ...init,
              method: hop.method,
              headers: hop.headers,
              body: hop.body,
              redirect: "manual",
              signal,
            }));
        const location = response.headers.get("location");
        if (!redirectStatuses.has(response.status) || location === null) return response;
        void response.body?.cancel().catch(() => undefined);
        if (followed === maxRedirects)
          throw new ConnectorError("invalid_response", "the provider redirected too many times");
        hop = nextHop(hop, response, location);
      }
    } catch (error) {
      if (timeout.aborted && !caller?.aborted)
        throw new ConnectorError("provider_unavailable", "the provider request timed out");
      throw error;
    }
  };
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

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
