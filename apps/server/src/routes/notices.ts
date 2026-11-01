import { Hono } from "hono";

import { noticeReadBodySchema } from "@headroom/view-model/app-feed";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

/** The owner's read marks for the dashboard. Apps use `PUT /api/app/v1/notices/read`. */
export function noticeRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  app.get("/read", (c) => c.json({ ids: ctx.noticeReads.list() }));

  app.put("/read", async (c) => {
    const body = noticeReadBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    return c.json({ ids: ctx.noticeReads.mark(body.data.ids, body.data.read) });
  });

  return app;
}
