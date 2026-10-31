import { Hono } from "hono";
import { z } from "zod";

import { ApiTokenStore } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

/** `refresh` opts the token into changing Refresh Every; every token can read. */
const createBody = z
  .object({ name: z.string().trim().min(1).max(40), refresh: z.boolean().optional() })
  .strict();
const tokenId = z.string().min(1).max(128);

export function tokenRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  const store = new ApiTokenStore(ctx.db);
  app.use(requireSession(ctx));
  app.use(async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/", (c) => {
    const tokens = store.list(c.get("session").user.id).map((token) => ({
      id: token.id,
      name: token.name,
      prefix: token.prefix,
      start: token.start,
      createdAt: token.createdAt.getTime(),
      lastUsedAt: token.lastUsedAt?.getTime() ?? null,
      expiresAt: token.expiresAt?.getTime() ?? null,
      scopes: token.scopes,
    }));
    return c.json({ tokens });
  });
  app.post("/", async (c) => {
    const parsed = createBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const token = await ctx.auth.api.createApiKey({
      body: {
        name: parsed.data.name,
        userId: c.get("session").user.id,
        permissions: { app: parsed.data.refresh === true ? ["read", "refresh"] : ["read"] },
      },
    });
    return c.json({ id: token.id, name: token.name, key: token.key }, 201);
  });
  app.delete("/:id", (c) => {
    const id = tokenId.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "invalid_id" }, 400);
    const removed = store.revoke(c.get("session").user.id, id.data);
    if (!removed) return c.json({ error: "not_found" }, 404);
    return c.json({ success: true });
  });
  return app;
}
