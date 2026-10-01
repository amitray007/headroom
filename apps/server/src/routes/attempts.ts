import { Hono } from "hono";
import { z } from "zod";

import {
  authMethodSchema,
  connectionScopeSchema,
  providerSchema,
  submitInputSchema,
} from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";
import { handleServiceError } from "./errors.ts";

const beginBody = z.object({
  provider: providerSchema,
  method: authMethodSchema,
  scope: connectionScopeSchema.default("individual"),
});
const inputBody = z.object({ input: submitInputSchema });

export function attemptRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  app.post("/", async (c) => {
    const body = beginBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      const attempt = await ctx.connect.begin(body.data);
      return c.json({ attempt }, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  });

  /** Browser polling; the service decides whether to ask the provider. */
  app.get("/:id", async (c) => {
    try {
      return c.json({ attempt: await ctx.connect.poll(c.req.param("id")) });
    } catch (error) {
      return handleServiceError(c, error);
    }
  });

  app.post("/:id/input", async (c) => {
    const body = inputBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      return c.json({ attempt: await ctx.connect.submit(c.req.param("id"), body.data.input) });
    } catch (error) {
      return handleServiceError(c, error);
    }
  });

  app.post("/:id/cancel", async (c) => {
    try {
      return c.json({ attempt: await ctx.connect.cancel(c.req.param("id")) });
    } catch (error) {
      return handleServiceError(c, error);
    }
  });

  return app;
}
