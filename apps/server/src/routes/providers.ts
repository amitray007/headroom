import { Hono } from "hono";

import { type Connector, type MethodAvailability, authMethodSchema } from "@headroom/core";

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
        availability: connector.supportedMethods.map((method) => availabilityOf(connector, method)),
      })),
    }),
  );
  return app;
}

/** One entry per method; a connector without the hook, or a method it does not check, is available. */
function availabilityOf(connector: Connector, method: string): MethodAvailability {
  const parsed = authMethodSchema.parse(method);
  return (
    connector.methodAvailability?.(parsed) ?? {
      method: parsed,
      available: true,
      reason: null,
      cli: null,
    }
  );
}
