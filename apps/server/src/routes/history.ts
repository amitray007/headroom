import { Hono } from "hono";

import { readHistory } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

const day = 86_400_000;
const bucketMs = 3_600_000;
const ranges = new Set(["7", "30", "90"]);

/** Usage history for the Analytics view: hourly maxima of each percent-of-limit reading, per account. */
export function historyRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  app.get("/", (c) => {
    const param = c.req.query("days") ?? "90";
    if (!ranges.has(param)) return c.json({ error: "invalid_days" }, 400);
    const to = ctx.now().getTime();
    const from = to - Number(param) * day;
    const connectionIds = ctx.order.arrange(ctx.connections.list()).map((row) => row.id);
    return c.json({
      from,
      to,
      bucketMs,
      retentionDays: ctx.settings.get().historyRetentionDays,
      connections: readHistory(ctx.db, { from, to, bucketMs, connectionIds }),
    });
  });

  return app;
}
