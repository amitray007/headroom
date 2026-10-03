import { Hono } from "hono";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

/**
 * The Wallet's exchange rates: read-only for the owner. Neither route touches an account, so Demo Mode does not
 * matter here. The server fetches from the outside service; the browser never does.
 */
export function exchangeRateRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  app.get("/", async (c) => c.json(await ctx.exchangeRates.get()));
  app.post("/refresh", async (c) => c.json(await ctx.exchangeRates.refresh()));

  return app;
}
