import { Hono } from "hono";

import {
  costSchema,
  TopUpPriceError,
  topUpInputSchema,
  topUpUpdateSchema,
  UnknownConnectionError,
  UnknownTopUpError,
  type WalletBook,
} from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

/**
 * The Wallet: what the owner pays per account and the credits they top up. Owner-entered records
 * only. Nothing here touches a provider, so Demo Mode does not matter. Every write answers with
 * the whole book so the browser stays in step.
 */
export function walletRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  const book = (): WalletBook => ctx.wallet.book();

  app.get("/", (c) => c.json(book()));

  app.put("/costs/:connectionId", async (c) => {
    const body = costSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      ctx.wallet.setCost(c.req.param("connectionId"), body.data);
    } catch (error) {
      if (error instanceof UnknownConnectionError)
        return c.json({ error: "unknown_connection" }, 404);
      throw error;
    }
    return c.json(book());
  });

  app.delete("/costs/:connectionId", (c) => {
    ctx.wallet.clearCost(c.req.param("connectionId"));
    return c.json(book());
  });

  app.post("/top-ups", async (c) => {
    const body = topUpInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      ctx.wallet.addTopUp(body.data);
    } catch (error) {
      if (error instanceof UnknownConnectionError)
        return c.json({ error: "unknown_connection" }, 404);
      throw error;
    }
    return c.json(book());
  });

  /** Replace a top-up's editable fields. A detected top-up may stay paid with no price. */
  app.put("/top-ups/:id", async (c) => {
    const body = topUpUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      ctx.wallet.updateTopUp(c.req.param("id"), body.data);
    } catch (error) {
      if (error instanceof UnknownTopUpError) return c.json({ error: "unknown_top_up" }, 404);
      if (error instanceof TopUpPriceError) return c.json({ error: "invalid_body" }, 400);
      throw error;
    }
    return c.json(book());
  });

  app.delete("/top-ups/:id", (c) => {
    ctx.wallet.removeTopUp(c.req.param("id"));
    return c.json(book());
  });

  return app;
}
