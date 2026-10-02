import { splitLabel } from "@headroom/core";

import type { AppContext } from "./bootstrap.ts";
import { metricJson, ms, resetCreditJson } from "./routes/serialize.ts";

/** What the overview rows need from the context. A narrow pick lets bootstrap call it before the context exists. */
export type OverviewSource = Pick<
  AppContext,
  "config" | "order" | "connections" | "snapshots" | "actions"
>;

/**
 * Every account with its latest snapshot, run and action state, in the owner's order. The
 * overview route returns it as is, and the notification dispatcher derives events from it.
 */
export function overviewConnections(source: OverviewSource, now: number) {
  const staleAfterMs = source.config.staleAfterSeconds * 1000;
  return source.order.arrange(source.connections.list()).map((connection) => {
    const run = source.snapshots.latestRun(connection.id);
    const latest = source.snapshots.latest(connection.id);
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
        enabled: source.actions.enabled,
        supported: [...source.actions.supported(connection.provider)],
      },
    };
  });
}

export type OverviewConnectionLike = ReturnType<typeof overviewConnections>[number];
