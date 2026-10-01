import { Hono } from "hono";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";

export function providerRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));
  app.get("/", (c) =>
    c.json({
      providers: ctx.registry.list().map((connector) => ({
        provider: connector.provider,
        version: connector.version,
        interface: connector.interface,
        methods: connector.supportedMethods,
      })),
    }),
  );
  return app;
}
