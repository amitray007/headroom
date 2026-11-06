import { gunzipSync, gzipSync } from "node:zlib";

import { Hono } from "hono";
import { accepts } from "hono/accepts";

import { historyMarker } from "@headroom/core";
import { encodeHistory } from "@headroom/view-model/history";

import { parseTz } from "./tz.ts";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";
import { bucketMs, historyRequest, readHourlyHistory, type SharedHistory } from "../read-model.ts";

const ranges = new Set(["7", "30", "90"]);
const cacheLimit = 8;

/**
 * Usage history for the Analytics view: hourly maxima of each percent-of-limit reading, per
 * account, in hours that start on the owner's local boundaries (`tz`). A read blocks the single
 * thread, so the reader keeps its hourly fold and reads only new readings after a sync, and the
 * body is cached gzipped until a snapshot, sync run or event changes.
 */
export function historyRoutes(ctx: AppContext, history: SharedHistory): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));
  const cache = new Map<string, Uint8Array<ArrayBuffer>>();

  app.get("/", (c) => {
    const param = c.req.query("days") ?? "90";
    if (!ranges.has(param)) return c.json({ error: "invalid_days" }, 400);
    const tz = parseTz(c.req.query("tz"));
    if (tz === null) return c.json({ error: "invalid_tz" }, 400);
    history.lastTzOffsetMinutes = tz;
    const request = historyRequest(ctx, ctx.now().getTime(), Number(param));
    const { connectionIds } = request;
    const key = [
      param,
      tz,
      request.retentionDays,
      Math.floor(request.to / bucketMs),
      historyMarker(ctx.db, connectionIds),
      connectionIds.toSorted().join(","),
    ].join("|");
    let body = cache.get(key);
    if (body === undefined) {
      const json = JSON.stringify(
        encodeHistory(readHourlyHistory(ctx, history.reader, request, tz)),
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
