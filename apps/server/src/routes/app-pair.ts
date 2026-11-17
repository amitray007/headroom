import { type Context, Hono } from "hono";

import {
  appPairStartBodySchema,
  appPairStartSchema,
  appPairTokenBodySchema,
  appPairTokenSchema,
} from "@headroom/view-model/app-feed";

import type { AppContext } from "../bootstrap.ts";
import type { Env } from "../middleware/session.ts";
import { pairingPollSeconds, pairingTtlSeconds } from "../pairing.ts";

/**
 * How the Mac app gets its read-only token (D48). Mounted before requireApiToken: the app has no
 * token yet. Only a device code, which the pairing hands out once, leads to a token.
 */
export function appPairRoutes(ctx: AppContext, address: (c: Context<Env>) => string): Hono<Env> {
  const app = new Hono<Env>();
  app.use(async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.post("/", async (c) => {
    const body = appPairStartBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const started = ctx.pairings.start(body.data.name, address(c));
    if (!started.ok) {
      c.header("Retry-After", String(started.retryAfterSeconds));
      return c.json({ error: "rate_limited" }, 429);
    }
    return c.json(
      appPairStartSchema.parse({
        code: started.code,
        deviceCode: started.deviceCode,
        expiresIn: pairingTtlSeconds,
        interval: pairingPollSeconds,
      }),
    );
  });
  app.post("/token", async (c) => {
    const body = appPairTokenBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const polled = ctx.pairings.poll(body.data.deviceCode);
    if (polled.status === "unknown") return c.json({ error: "not_found" }, 404);
    if (polled.status !== "approved") return c.json(appPairTokenSchema.parse(polled));
    const token = await ctx.auth.api.createApiKey({
      body: { name: polled.name, userId: polled.userId, permissions: { app: ["read"] } },
    });
    return c.json(appPairTokenSchema.parse({ status: "approved", token: token.key }));
  });
  return app;
}
