import { Hono } from "hono";

import { InvalidOrderError, orderBodySchema } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

/** Owner-defined order of providers and of accounts within each provider. */
export function orderRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  app.put("/", async (c) => {
    const body = orderBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      return c.json(ctx.order.apply(body.data));
    } catch (error) {
      if (error instanceof InvalidOrderError) return c.json({ error: "invalid_body" }, 400);
      throw error;
    }
  });

  return app;
}
