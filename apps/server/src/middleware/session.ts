import type { MiddlewareHandler } from "hono";

import type { SessionInfo } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";

export type Env = {
  Variables: { session: SessionInfo };
};

/** Requires a valid Better Auth session; sets `session` on the context. */
export function requireSession(ctx: AppContext): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = await ctx.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "authentication_required" }, 401);
    c.set("session", session);
    await next();
    return undefined;
  };
}

/**
 * Cross-site request protection for Headroom's own state-changing routes. Better Auth
 * checks its own routes against trustedOrigins. Browsers send Sec-Fetch-Site on every
 * request; a cross-site value is rejected. Clients without it must present an Origin
 * in the trusted list, or no Origin at all.
 */
export function rejectCrossSite(ctx: AppContext): MiddlewareHandler {
  return async (c, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) return next();
    const site = c.req.header("sec-fetch-site");
    if (site === "cross-site") return c.json({ error: "cross_site_request" }, 403);
    const origin = c.req.header("origin");
    if (origin && site !== "same-origin" && !ctx.trustedOrigins.includes(origin)) {
      return c.json({ error: "cross_site_request" }, 403);
    }
    await next();
    return undefined;
  };
}
