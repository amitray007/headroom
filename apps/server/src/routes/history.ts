import { Hono } from "hono";
import { compress } from "hono/compress";

import { historyMarker, readHistory } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

const day = 86_400_000;
const bucketMs = 3_600_000;
const ranges = new Set(["7", "30", "90"]);
const cacheLimit = 8;

/** Minutes east of UTC as a plain integer in the real-world range, or null. */
function parseTz(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  if (!/^-?\d{1,4}$/.test(raw)) return null;
  const tz = Number(raw);
  return tz >= -720 && tz <= 840 ? tz : null;
}

/**
 * Usage history for the Analytics view: hourly maxima of each percent-of-limit reading, per
 * account, in hours that start on the owner's local boundaries (`tz`). A read blocks the single
 * thread, so the serialized body is cached until a snapshot, sync run or event changes.
 */
export function historyRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));
  app.use(compress());
  const cache = new Map<string, string>();

  app.get("/", (c) => {
    const param = c.req.query("days") ?? "90";
    if (!ranges.has(param)) return c.json({ error: "invalid_days" }, 400);
    const tz = parseTz(c.req.query("tz"));
    if (tz === null) return c.json({ error: "invalid_tz" }, 400);
    const to = ctx.now().getTime();
    const from = to - Number(param) * day;
    const connectionIds = ctx.order.arrange(ctx.connections.list()).map((row) => row.id);
    const retentionDays = ctx.settings.get().historyRetentionDays;
    const key = [
      param,
      tz,
      retentionDays,
      Math.floor(to / bucketMs),
      historyMarker(ctx.db, connectionIds),
      connectionIds.toSorted().join(","),
    ].join("|");
    let body = cache.get(key);
    if (body === undefined) {
      body = JSON.stringify({
        from,
        to,
        bucketMs,
        retentionDays,
        connections: readHistory(ctx.db, {
          from,
          to,
          bucketMs,
          tzOffsetMinutes: tz,
          connectionIds,
        }),
      });
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
      cache.set(key, body);
    }
    return c.body(body, 200, { "content-type": "application/json" });
  });

  return app;
}
