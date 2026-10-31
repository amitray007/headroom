import type { Context, MiddlewareHandler } from "hono";

import { apiTokenScopesOf } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import type { Env } from "./session.ts";

/** The one write a token can make, and only with the `refresh` scope. */
const refreshPath = /\/app\/v1\/settings\/refresh$/;

/** Per-process failed-attempt window, bounded even when many addresses send invalid keys. */
export function requireApiToken(
  ctx: AppContext,
  address: (c: Context<Env>) => string,
): MiddlewareHandler<Env> {
  const failures = new Map<string, { count: number; until: number }>();
  const windowMs = 60_000;
  const maxFailures = 10;
  return async (c, next) => {
    c.header("Cache-Control", "no-store");
    const write = refreshPath.test(c.req.path);
    const allowed = write ? ["PUT"] : ["GET", "HEAD"];
    if (!allowed.includes(c.req.method)) {
      c.header("Allow", allowed.join(", "));
      return c.json({ error: "method_not_allowed" }, 405);
    }
    const now = ctx.now().getTime();
    const client = address(c);
    const failed = failures.get(client);
    if (failed && failed.until <= now) failures.delete(client);
    else if (failed && failed.count >= maxFailures) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((failed.until - now) / 1000))));
      return c.json({ error: "rate_limited" }, 429);
    }
    const match = /^Bearer ([A-Za-z0-9_-]{1,256})$/.exec(c.req.header("authorization") ?? "");
    const result = match?.[1]
      ? await ctx.auth.api.verifyApiKey({
          body: { key: match[1], permissions: { app: ["read"] } },
        })
      : null;
    if (!result?.valid || !result.key) {
      const current = failures.get(client);
      // Sweep expired addresses only when the window is full, not on every poll.
      if (!current && failures.size >= 10_000) {
        for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
      }
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
    const scopes = apiTokenScopesOf(result.key.permissions);
    // A valid token without the scope is not a failed guess: it is refused, not counted.
    if (write && !scopes.includes("refresh")) return c.json({ error: "missing_permission" }, 403);
    c.set("apiTokenName", result.key.name);
    c.set("apiTokenScopes", scopes);
    await next();
    return undefined;
  };
}
