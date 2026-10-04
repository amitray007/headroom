import { Hono } from "hono";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";
import { overviewConnections } from "../overview-model.ts";

/** Everything the single page needs in one call: every account with its latest snapshot and run. */
export function overviewRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  app.get("/", (c) => {
    const now = ctx.now().getTime();
    const staleAfterMs = ctx.config.staleAfterSeconds * 1000;
    const connections = overviewConnections(ctx, now);
    return c.json({
      connections,
      providerOrder: ctx.order.providerOrder(),
      refreshIntervalMs: ctx.settings.get().refreshIntervalMinutes * 60_000,
      staleAfterMs,
    });
  });

  return app;
}
