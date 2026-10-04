import { describe, expect, test } from "bun:test";

import { classifyUnknown, ConnectorError } from "./connector.ts";
import { retryAfterMs, throwForStatus, timeoutFetch } from "./http.ts";

const respond = (status: number, headers: Record<string, string> = {}) =>
  new Response("synthetic body", { status, headers });

function thrown(fn: () => void): ConnectorError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConnectorError) return error;
  }
  throw new Error("expected a ConnectorError");
}

/** A fetch that never answers but honours its abort signal, like the real one. */
const hung = (_input: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

describe("timeoutFetch", () => {
  test("aborts a hung request and classifies it as a transient provider_unavailable", async () => {
    const error = await timeoutFetch(hung, 20)
      .call(null, "https://example.test")
      .catch((e) => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(classifyUnknown(error)).toMatchObject({
      category: "provider_unavailable",
      class: "transient",
    });
  });

  test("passes a prompt response through and keeps the caller's signal working", async () => {
    const ok = timeoutFetch(() => Promise.resolve(respond(200)), 1000);
    expect((await ok("https://example.test")).status).toBe(200);
    const caller = new AbortController();
    const pending = timeoutFetch(hung, 5000)("https://example.test", { signal: caller.signal });
    caller.abort(new Error("caller gave up"));
    const error = await pending.catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ConnectorError);
  });

  test("a bare timeout or abort error from any source classifies as transient", () => {
    expect(classifyUnknown(new DOMException("t", "TimeoutError"))).toMatchObject({
      category: "provider_unavailable",
      class: "transient",
    });
    expect(classifyUnknown(new DOMException("a", "AbortError")).class).toBe("transient");
  });
});

describe("retryAfterMs", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");

  test("falls back when the header is missing or unreadable", () => {
    expect(retryAfterMs(respond(429), 60_000, now)).toBe(60_000);
    expect(retryAfterMs(respond(429), 90_000, now)).toBe(90_000);
    expect(retryAfterMs(respond(429, { "retry-after": "soon" }), 60_000, now)).toBe(60_000);
  });

  test("honours delta-seconds and HTTP dates inside the clamp", () => {
    expect(retryAfterMs(respond(429, { "retry-after": "120" }), 60_000, now)).toBe(120_000);
    const date = new Date(now + 5 * 60_000).toUTCString();
    expect(retryAfterMs(respond(429, { "retry-after": date }), 60_000, now)).toBe(300_000);
  });

  test("clamps to one minute..one hour", () => {
    expect(retryAfterMs(respond(429, { "retry-after": "0" }), 60_000, now)).toBe(60_000);
    expect(retryAfterMs(respond(429, { "retry-after": "5" }), 60_000, now)).toBe(60_000);
    expect(retryAfterMs(respond(429, { "retry-after": "86400" }), 60_000, now)).toBe(3_600_000);
    const past = new Date(now - 10 * 60_000).toUTCString();
    expect(retryAfterMs(respond(429, { "retry-after": past }), 60_000, now)).toBe(60_000);
  });
});

describe("throwForStatus", () => {
  test("maps the status ladder", () => {
    expect(() => throwForStatus(respond(200), "x")).not.toThrow();
    expect(thrown(() => throwForStatus(respond(401), "x")).category).toBe(
      "authentication_required",
    );
    expect(thrown(() => throwForStatus(respond(403), "x")).category).toBe("permission_denied");
    expect(thrown(() => throwForStatus(respond(503), "x")).category).toBe("provider_unavailable");
    expect(thrown(() => throwForStatus(respond(418), "x")).category).toBe("invalid_response");
    const limited = thrown(() => throwForStatus(respond(429, { "retry-after": "120" }), "x"));
    expect(limited).toMatchObject({ category: "rate_limited", retryAfterMs: 120_000 });
  });

  test("a 403 is a rate limit only when the hook says so", () => {
    const options = { forbiddenIsRateLimit: () => true };
    expect(thrown(() => throwForStatus(respond(403), "x", options)).category).toBe("rate_limited");
    expect(thrown(() => throwForStatus(respond(403), "x")).category).toBe("permission_denied");
  });

  test("the message never carries the response body", () => {
    expect(thrown(() => throwForStatus(respond(500), "usage")).message).not.toContain("synthetic");
  });
});
