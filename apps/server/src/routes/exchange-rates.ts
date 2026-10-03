import { Hono } from "hono";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

/**
 * The Wallet's exchange rates: read-only for the owner. The route touches no account, so Demo Mode does not
 * matter here. The server fetches from the outside service on its own schedule; the browser never does.
 */
export function exchangeRateRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  app.get("/", async (c) => c.json(await ctx.exchangeRates.get()));

  return app;
}
