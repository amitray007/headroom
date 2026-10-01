import { Hono } from "hono";

import { connectionStates } from "@headroom/core";

export const version = "0.0.0";

export function createApp(): Hono {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ status: "ok", version, connectionStates }));
  return app;
}
