import { Hono } from "hono";

import { appliedMigrations } from "@headroom/core";

import type { AppContext } from "./bootstrap.ts";
import { rejectCrossSite } from "./middleware/session.ts";
import { authRoutes } from "./routes/auth.ts";

export const version = "0.0.0";

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    ctx.log("error", `${c.req.method} ${c.req.path}: ${error.name}`);
    return c.json({ error: "internal_error" }, 500);
  });

  app.get("/healthz", (c) => c.json({ status: "ok", version }));

  const api = new Hono();
  api.use(rejectCrossSite(ctx));
  api.route("/auth", authRoutes(ctx));
  app.route("/api", api);

  return app;
}

export function describeDatabase(ctx: AppContext): { migrations: string[] } {
  return { migrations: appliedMigrations(ctx.sqlite) };
}
