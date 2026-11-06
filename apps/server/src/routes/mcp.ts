import { createMcpHandler } from "@modelcontextprotocol/server";
import { Hono } from "hono";

import type { HistoryReader } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { createMcpServer } from "../mcp/server.ts";
import type { Env } from "../middleware/session.ts";

/** Mounted after requireApiToken, which allows POST only. */
export function mcpRoutes(ctx: AppContext, reader: HistoryReader): Hono<Env> {
  const app = new Hono<Env>();
  const handler = createMcpHandler(() => createMcpServer(ctx, reader), {
    onerror: (error) => ctx.log("warn", `mcp: ${error.name}`),
  });
  app.post("/", (c) => handler.fetch(c.req.raw));
  return app;
}
