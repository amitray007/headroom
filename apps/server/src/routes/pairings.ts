import { Hono } from "hono";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";
import type { PairingDecision } from "../pairing.ts";

const decisionStatus: Record<Exclude<PairingDecision, "decided">, 404 | 409> = {
  unknown: 404,
  not_pending: 409,
};

/** The dashboard's side of device pairing (D48): the owner looks up the code on the Mac's screen, then allows or denies it. */
export function pairingRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));
  app.use(async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/:code", (c) => {
    const pairing = ctx.pairings.find(c.req.param("code"));
    return pairing ? c.json(pairing) : c.json({ error: "not_found" }, 404);
  });
  app.post("/:code/approve", (c) => {
    const result = ctx.pairings.approve(c.req.param("code"), c.get("session").user.id);
    return result === "decided"
      ? c.json({ success: true })
      : c.json({ error: result === "unknown" ? "not_found" : result }, decisionStatus[result]);
  });
  app.post("/:code/deny", (c) => {
    const result = ctx.pairings.deny(c.req.param("code"));
    return result === "decided"
      ? c.json({ success: true })
      : c.json({ error: result === "unknown" ? "not_found" : result }, decisionStatus[result]);
  });
  return app;
}
