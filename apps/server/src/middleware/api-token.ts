import type { MiddlewareHandler } from "hono";

import { apiTokenScopes } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import type { Env } from "./session.ts";

/** Per-process failed-attempt window, bounded even when many addresses send invalid keys. */
export function requireApiToken(
  ctx: AppContext,
  address: (c: Parameters<MiddlewareHandler<Env>>[0]) => string,
): MiddlewareHandler<Env> {
  const failures = new Map<string, { count: number; until: number }>();
  const windowMs = 60_000;
  const maxFailures = 10;
  return async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      c.header("Allow", "GET, HEAD");
      return c.json({ error: "method_not_allowed" }, 405);
    }
    const now = ctx.now().getTime();
    for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
    const client = address(c);
    const failed = failures.get(client);
    if (failed && failed.count >= maxFailures) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((failed.until - now) / 1000))));
      return c.json({ error: "rate_limited" }, 429);
    }
    const match = /^Bearer ([A-Za-z0-9_-]{1,256})$/.exec(c.req.header("authorization") ?? "");
    const result = match?.[1]
      ? await ctx.auth.api.verifyApiKey({
          body: { key: match[1], permissions: { app: [...apiTokenScopes] } },
        })
      : null;
    if (!result?.valid || !result.key) {
      const current = failures.get(client);
      if (!current && failures.size >= 10_000) {
        // Fail closed rather than evicting an address that is still being throttled.
        c.header("Retry-After", "60");
        return c.json({ error: "rate_limited" }, 429);
      }
      failures.set(client, {
        count: (current?.count ?? 0) + 1,
        until: current?.until ?? now + windowMs,
      });
      return c.json({ error: "invalid_token" }, 401);
    }
    c.set("apiTokenName", result.key.name);
    await next();
    return undefined;
  };
}
