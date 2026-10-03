import { existsSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";
import { getConnInfo, serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import {
  appliedMigrations,
  clientIpHeader,
  minimumPasswordLength,
  minimumUsernameLength,
  ownerExists,
} from "@headroom/core";

import type { AppContext } from "./bootstrap.ts";
import { version } from "./version.ts";
import { type Env, rejectCrossSite, requireSession } from "./middleware/session.ts";
import { attemptRoutes } from "./routes/attempts.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { deliveryRoutes } from "./routes/delivery.ts";
import { exchangeRateRoutes } from "./routes/exchange-rates.ts";
import { orderRoutes } from "./routes/order.ts";
import { overviewRoutes } from "./routes/overview.ts";
import { providerRoutes } from "./routes/providers.ts";
import { settingsRoutes } from "./routes/settings.ts";

const brandFiles = [
  "favicon.ico",
  "favicon.svg",
  "favicon-32.png",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "manifest.webmanifest",
];

export { version };

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
        // The avatar is a seeded DiceBear image; the browser fetches it, so this origin is the only external one.
        imgSrc: ["'self'", "data:", "https://api.dicebear.com"],
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
  api.on(["GET", "POST"], "/auth/*", (c) => {
    const headers = new Headers(c.req.raw.headers);
    headers.set(
      clientIpHeader,
      clientAddress(c.req.raw, ctx.config.trustProxy, () => socketAddress(c)),
    );
    return ctx.auth.handler(new Request(c.req.raw, { headers }));
  });

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
  api.route("/overview", overviewRoutes(ctx));
  api.route("/order", orderRoutes(ctx));
  api.route("/settings", settingsRoutes(ctx));
  api.route("/delivery", deliveryRoutes(ctx));
  api.route("/exchange-rates", exchangeRateRoutes(ctx));

  app.route("/api", api);

  // Built web UI, when present: static assets, then index.html for client-side routes.
  const webDir = ctx.config.webDir;
  if (webDir && existsSync(join(webDir, "index.html"))) {
    app.use("/assets/*", serveStatic({ root: webDir }));
    // Brand files from apps/web/public sit at the root: browsers request /favicon.ico unprompted.
    for (const file of brandFiles) app.get(`/${file}`, serveStatic({ root: webDir }));
    app.get("*", serveStatic({ root: webDir, path: "index.html" }));
  }
  return app;
}

/**
 * The address Better Auth throttles on. A client-supplied value is always discarded;
 * X-Forwarded-For is honoured only when the deployment says a trusted proxy sets it.
 */
export function clientAddress(
  request: Request,
  trustProxy: boolean,
  socket: () => string | null,
): string {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return socket() ?? "unknown";
}

function socketAddress(c: Parameters<typeof getConnInfo>[0]): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    // app.request() in tests has no socket.
    return null;
  }
}

export function describeDatabase(ctx: AppContext): { migrations: string[] } {
  return { migrations: appliedMigrations(ctx.sqlite) };
}
