import { Hono } from "hono";
import { z } from "zod";

import { minimumPasswordLength, OwnerExistsError, WeakPasswordError } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { clearSession, type Env, issueSession, requireSession } from "../middleware/session.ts";

const passwordBody = z.object({ password: z.string().min(1).max(1024) });
const changeBody = z.object({ current: z.string().min(1), next: z.string().min(1).max(1024) });

export function authRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();

  /** Whether the owner exists yet. The only unauthenticated read besides /healthz. */
  app.get("/setup", (c) => c.json({ ownerExists: ctx.owner.hasOwner(), minimumPasswordLength }));

  app.post("/setup", async (c) => {
    const body = passwordBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      const { ownerId } = await ctx.owner.bootstrap(body.data.password);
      issueSession(c, ctx, ownerId);
      return c.json({ ok: true }, 201);
    } catch (error) {
      if (error instanceof OwnerExistsError) return c.json({ error: "owner_exists" }, 409);
      if (error instanceof WeakPasswordError)
        return c.json({ error: "weak_password", minimumPasswordLength }, 400);
      throw error;
    }
  });

  app.post("/session", async (c) => {
    const body = passwordBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const ownerId = await ctx.owner.verifyPassword(body.data.password);
    if (!ownerId) return c.json({ error: "invalid_password" }, 401);
    issueSession(c, ctx, ownerId);
    return c.json({ ok: true });
  });

  app.delete("/session", (c) => {
    clearSession(c, ctx);
    return c.json({ ok: true });
  });

  app.get("/me", requireSession(ctx), (c) => c.json({ ownerId: c.get("ownerId") }));

  app.post("/password", requireSession(ctx), async (c) => {
    const body = changeBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      const changed = await ctx.owner.changePassword(body.data.current, body.data.next);
      if (!changed) return c.json({ error: "invalid_password" }, 401);
    } catch (error) {
      if (error instanceof WeakPasswordError)
        return c.json({ error: "weak_password", minimumPasswordLength }, 400);
      throw error;
    }
    clearSession(c, ctx);
    return c.json({ ok: true });
  });

  return app;
}
