import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { AppContext } from "../bootstrap.ts";

const sessionCookieName = "headroom_session";

export type Env = {
  Variables: { ownerId: string };
};

function secureCookies(ctx: AppContext): boolean {
  return ctx.config.publicUrl?.startsWith("https://") ?? false;
}

export function issueSession(c: Context, ctx: AppContext, ownerId: string): void {
  const { token, expiresAt } = ctx.owner.createSession(ownerId);
  setCookie(c, sessionCookieName, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: secureCookies(ctx),
    path: "/",
    expires: expiresAt,
  });
}

export function clearSession(c: Context, ctx: AppContext): void {
  const token = getCookie(c, sessionCookieName);
  if (token) ctx.owner.revokeSession(token);
  deleteCookie(c, sessionCookieName, { path: "/" });
}

/** Requires a valid session cookie; sets `ownerId` on the context. */
export function requireSession(ctx: AppContext): MiddlewareHandler<Env> {
  return async (c, next) => {
    const token = getCookie(c, sessionCookieName);
    const session = token ? ctx.owner.validateSession(token) : null;
    if (!session) return c.json({ error: "authentication_required" }, 401);
    c.set("ownerId", session.ownerId);
    await next();
    return undefined;
  };
}

/**
 * Cross-site request protection for state-changing methods. Browsers send
 * Sec-Fetch-Site on every request; a cross-site value is rejected. Older or
 * non-browser clients without it must present a matching Origin, or no Origin at all.
 */
export function rejectCrossSite(ctx: AppContext): MiddlewareHandler {
  return async (c, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) return next();
    const site = c.req.header("sec-fetch-site");
    if (site === "cross-site") return c.json({ error: "cross_site_request" }, 403);
    const origin = c.req.header("origin");
    if (origin && site !== "same-origin") {
      const expected = ctx.config.publicUrl ?? new URL(c.req.url).origin;
      if (origin !== expected) return c.json({ error: "cross_site_request" }, 403);
    }
    await next();
    return undefined;
  };
}
