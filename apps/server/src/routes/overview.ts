import { Hono } from "hono";

import { splitLabel } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";
import { metricJson, ms, resetCreditJson } from "./serialize.ts";

/** Everything the single page needs in one call: every account with its latest snapshot and run. */
export function overviewRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  app.get("/", (c) => {
    const now = ctx.now().getTime();
    const staleAfterMs = ctx.config.staleAfterSeconds * 1000;
    const rows = ctx.order.arrange(ctx.connections.list());
    const connections = rows.map((connection) => {
      const run = ctx.snapshots.latestRun(connection.id);
      const latest = ctx.snapshots.latest(connection.id);
      const lastSuccessAt = ms(connection.lastSuccessAt);
      const { identity, plan } = splitLabel(connection.provider, connection.label);
      return {
        id: connection.id,
        provider: connection.provider,
        scope: connection.scope,
        state: connection.state,
        reconnectReason: connection.reconnectReason,
        interface: connection.interface,
        authMethod: connection.authMethod,
        name: connection.displayName,
        identity,
        plan,
        createdAt: connection.createdAt.getTime(),
        lastSuccessAt,
        stale: lastSuccessAt === null ? false : now - lastSuccessAt > staleAfterMs,
        latestRun: run
          ? {
              startedAt: run.startedAt.getTime(),
              finishedAt: ms(run.finishedAt),
              outcome: run.outcome,
              error: run.sanitizedError,
            }
          : null,
        snapshot: latest
          ? {
              observedAt: latest.snapshot.observedAt.getTime(),
              metrics: latest.metrics.map(metricJson),
              resetCredits: latest.resetCredits.map(resetCreditJson),
            }
          : null,
        actions: {
          enabled: ctx.actions.enabled,
          supported: ctx.actions.supported(connection.provider),
        },
      };
    });
    return c.json({
      connections,
      providerOrder: ctx.order.providerOrder(),
      refreshIntervalMs: ctx.settings.get().refreshIntervalMinutes * 60_000,
      staleAfterMs,
    });
  });

  return app;
}
