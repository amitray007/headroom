import { createHash } from "node:crypto";
import { Hono } from "hono";

import { appWhoamiSchema, buildAppFeed } from "@headroom/view-model/app-feed";

import type { AppContext } from "../bootstrap.ts";
import type { Env } from "../middleware/session.ts";
import { overviewConnections } from "../overview-model.ts";
import { version } from "../version.ts";
import { parseTz } from "./tz.ts";

/** Mounted after requireApiToken and before the session-only routes. */
/** Feed representations kept per time zone offset, oldest dropped first. */
const cacheLimit = 8;

export function appRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  // Keep representation timestamps stable until visible content changes. Bound request offsets in memory.
  const cache = new Map<number, { content: string; body: string; etag: string }>();
  app.get("/whoami", (c) =>
    c.json(
      appWhoamiSchema.parse({
        apiVersion: 1,
        serverVersion: version,
        tokenName: c.get("apiTokenName"),
      }),
    ),
  );
  app.get("/feed", (c) => {
    const tz = parseTz(c.req.query("tz"));
    if (tz === null) return c.json({ error: "invalid_tz" }, 400);
    const now = ctx.now().getTime();
    const settings = ctx.settings.get();
    const feed = buildAppFeed({
      connections: overviewConnections(ctx, now),
      providerOrder: ctx.order.providerOrder(),
      serverVersion: version,
      generatedAt: now,
      refreshIntervalMs: settings.refreshIntervalMinutes * 60_000,
      staleAfterMs: ctx.config.staleAfterSeconds * 1000,
      dashboardUrl: ctx.config.publicUrl ?? null,
      settings,
      wallet: { ...ctx.wallet.book(), displayCurrency: settings.walletCurrency },
      rates: ctx.exchangeRates.view().perUsd,
      tzOffsetMinutes: tz,
    });
    const content = JSON.stringify({ ...feed, generatedAt: 0 });
    let representation = cache.get(tz);
    if (representation?.content !== content) {
      const body = JSON.stringify(feed);
      representation = {
        content,
        body,
        etag: `"${createHash("sha256").update(body).digest("hex")}"`,
      };
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
      cache.set(tz, representation);
    }
    c.header("ETag", representation.etag);
    // GET/HEAD validators use weak comparison, while the emitted validator is a strong body hash.
    const validators = c.req
      .header("if-none-match")
      ?.split(",")
      .map((tag) => tag.trim());
    if (validators?.some((tag) => tag === "*" || tag.replace(/^W\//, "") === representation.etag))
      return c.body(null, 304);
    return c.body(representation.body, 200, { "Content-Type": "application/json; charset=UTF-8" });
  });
  return app;
}
