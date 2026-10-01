import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import {
  appliedMigrations,
  minimumPasswordLength,
  minimumUsernameLength,
  ownerExists,
} from "@headroom/core";

import type { AppContext } from "./bootstrap.ts";
import { type Env, rejectCrossSite, requireSession } from "./middleware/session.ts";
import { attemptRoutes } from "./routes/attempts.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { providerRoutes } from "./routes/providers.ts";

export const version = "0.0.0";

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    ctx.log("error", `${c.req.method} ${c.req.path}: ${error.name}`);
    return c.json({ error: "internal_error" }, 500);
  });

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'self'", ...ctx.trustedOrigins],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
      },
      xFrameOptions: false,
      referrerPolicy: "same-origin",
      crossOriginOpenerPolicy: "same-origin",
      strictTransportSecurity: ctx.config.publicUrl?.startsWith("https://")
        ? "max-age=31536000; includeSubDomains"
        : false,
    }),
  );

  app.get("/healthz", (c) => c.json({ status: "ok", version }));

  const api = new Hono<Env>();
  api.use(
    cors({
      origin: (origin) => (ctx.trustedOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowHeaders: ["content-type", "authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  api.use(rejectCrossSite(ctx));

  /** Better Auth owns everything under /api/auth, including its own origin checks and rate limits. */
  api.on(["GET", "POST"], "/auth/*", (c) => ctx.auth.handler(c.req.raw));

  /** The only unauthenticated read besides /healthz: whether the owner has signed up yet. */
  api.get("/setup", (c) =>
    c.json({ ownerExists: ownerExists(ctx.db), minimumPasswordLength, minimumUsernameLength }),
  );

  api.get("/me", requireSession(ctx), (c) => {
    const { user } = c.get("session");
    return c.json({ id: user.id, name: user.name, email: user.email });
  });

  api.route("/providers", providerRoutes(ctx));
  api.route("/connections", connectionRoutes(ctx));
  api.route("/attempts", attemptRoutes(ctx));

  app.route("/api", api);
  return app;
}

export function describeDatabase(ctx: AppContext): { migrations: string[] } {
  return { migrations: appliedMigrations(ctx.sqlite) };
}
