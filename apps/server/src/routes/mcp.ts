import { createMcpHandler } from "@modelcontextprotocol/server";
import { Hono } from "hono";

import type { AppContext } from "../bootstrap.ts";
import { createMcpServer } from "../mcp/server.ts";
import type { Env } from "../middleware/session.ts";
import type { SharedHistory } from "../read-model.ts";

/** Mounted after requireApiToken, which allows POST only. */
export function mcpRoutes(ctx: AppContext, history: SharedHistory): Hono<Env> {
  const app = new Hono<Env>();
  const handler = createMcpHandler(() => createMcpServer(ctx, history), {
    onerror: (error) => ctx.log("warn", `mcp: ${error.name}`),
  });
  app.post("/", (c) => handler.fetch(c.req.raw));
  return app;
}
