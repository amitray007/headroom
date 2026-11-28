import { Hono } from "hono";
import { z } from "zod";

import {
  feedbackMaxLength,
  usageActions,
  usageViews,
  webErrorPlaces,
} from "@headroom/core/contracts";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";
import { errorType, framesOf } from "../telemetry-exceptions.ts";

const viewBody = z.object({ view: z.enum(usageViews) });
const actionBody = z.object({ action: z.enum(usageActions) });
const errorBody = z.object({
  type: z.string().max(100),
  where: z.enum(webErrorPlaces),
  stack: z.string().max(16_000),
});
const feedbackBody = z.object({ message: z.string().trim().min(1).max(feedbackMaxLength) });

/** The web app's page views and presses, and the owner's feedback, both sent on by the usage stats service (ADR 0007). */
export function usageRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  // Per route, not app.use: this app is mounted at /api, where a blanket guard would cover every route.
  app.post("/usage/view", requireSession(ctx), async (c) => {
    const body = viewBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    ctx.telemetry.markView(body.data.view);
    return c.body(null, 204);
  });

  app.post("/usage/action", requireSession(ctx), async (c) => {
    const body = actionBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    ctx.telemetry.markAction(body.data.action);
    return c.body(null, 204);
  });

  // The browser sends the raw stack; the server keeps only the class and cleaned frames.
  app.post("/usage/error", requireSession(ctx), async (c) => {
    const body = errorBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    ctx.telemetry.captureException({
      type: errorType(body.data.type),
      where: body.data.where,
      source: "web",
      frames: framesOf(body.data.stack),
    });
    return c.body(null, 204);
  });

  app.post("/feedback", requireSession(ctx), async (c) => {
    const body = feedbackBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const result = await ctx.telemetry.sendFeedback(body.data.message);
    if (result === "sent") return c.body(null, 204);
    if (result === "too_soon") return c.json({ error: "feedback_too_soon" }, 429);
    return c.json(
      { error: result === "unavailable" ? "feedback_unavailable" : "feedback_failed" },
      503,
    );
  });

  return app;
}
