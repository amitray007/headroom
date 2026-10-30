import { gunzipSync, gzipSync } from "node:zlib";

import { Hono } from "hono";
import { accepts } from "hono/accepts";

import { createHistoryReader, historyMarker } from "@headroom/core";
import { encodeHistory } from "@headroom/view-model/history";

import { parseTz } from "./tz.ts";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

const day = 86_400_000;
const bucketMs = 3_600_000;
const ranges = new Set(["7", "30", "90"]);
const longest = 90 * day;
const cacheLimit = 8;

/**
 * Usage history for the Analytics view: hourly maxima of each percent-of-limit reading, per
 * account, in hours that start on the owner's local boundaries (`tz`). A read blocks the single
 * thread, so the reader keeps its hourly fold and reads only new readings after a sync, and the
 * body is cached gzipped until a snapshot, sync run or event changes.
 */
export function historyRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));
  const reader = createHistoryReader({ keepMs: longest });
  const cache = new Map<string, Uint8Array<ArrayBuffer>>();

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
      const json = JSON.stringify(
        encodeHistory({
          from,
          to,
          bucketMs,
          retentionDays,
          connections: reader.read(ctx.db, {
            from,
            to,
            bucketMs,
            tzOffsetMinutes: tz,
            connectionIds,
          }),
        }),
      );
      body = gzipSync(json);
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
      cache.set(key, body);
    }
    // Only the gzip is kept: every browser accepts it, and a client that does not gets it unzipped.
    const gzip =
      accepts(c, { header: "Accept-Encoding", supports: ["gzip"], default: "" }) === "gzip";
    return gzip
      ? c.body(body, 200, {
          "content-type": "application/json",
          "content-encoding": "gzip",
          vary: "Accept-Encoding",
        })
      : c.body(gunzipSync(body), 200, {
          "content-type": "application/json",
          vary: "Accept-Encoding",
        });
  });

  return app;
}
