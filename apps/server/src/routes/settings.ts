import { Hono } from "hono";

import { settingsSchema } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

export function settingsRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  const view = () => ({ settings: ctx.settings.get() });

  app.get("/", (c) => c.json(view()));

  app.put("/", async (c) => {
    const body = settingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    ctx.settings.put(body.data);
    return c.json(view());
  });

  return app;
}
