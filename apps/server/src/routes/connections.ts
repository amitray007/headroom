import { Hono } from "hono";
import { z } from "zod";

import { accountActionKindSchema, authMethodSchema } from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";
import { handleServiceError } from "./errors.ts";
import { metricJson, ms, resetCreditJson } from "./serialize.ts";

const reconnectBody = z.object({ method: authMethodSchema });
const pauseBody = z.object({ paused: z.boolean() });
const maxNameLength = 40;
const renameBody = z.object({
  name: z
    .string()
    .nullable()
    .transform((value) => (value === null ? null : value.trim()))
    .refine((value) => value === null || value.length <= maxNameLength),
});
/** `confirm` must be literally true: the browser sets it after the owner confirmed the named credit. */
const actionBody = z.object({
  action: accountActionKindSchema,
  creditId: z.string().min(1).optional(),
  confirm: z.literal(true),
});

export function connectionRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  app.get("/", (c) => {
    const now = ctx.now().getTime();
    const staleAfterMs = ctx.config.staleAfterSeconds * 1000;
    const rows = ctx.order.arrange(ctx.connections.list()).map((connection) => {
      const run = ctx.snapshots.latestRun(connection.id);
      const latest = ctx.snapshots.latest(connection.id);
      const lastSuccessAt = connection.lastSuccessAt?.getTime() ?? null;
      return {
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        name: connection.displayName,
        scope: connection.scope,
        state: connection.state,
        reconnectReason: connection.reconnectReason,
        interface: connection.interface,
        authMethod: connection.authMethod,
        lastSuccessAt,
        stale: lastSuccessAt === null ? false : now - lastSuccessAt > staleAfterMs,
        latestRun: run
          ? { startedAt: run.startedAt.getTime(), outcome: run.outcome, error: run.sanitizedError }
          : null,
        metricCount: latest?.metrics.length ?? 0,
      };
    });
    return c.json({ connections: rows });
  });

  app.get("/:id", (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "not_found" }, 404);
    const latest = ctx.snapshots.latest(connection.id);
    const run = ctx.snapshots.latestRun(connection.id);
    return c.json({
      // Built field by field: the stored row also holds providerAccountId and workspaceId.
      connection: {
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        name: connection.displayName,
        scope: connection.scope,
        state: connection.state,
        reconnectReason: connection.reconnectReason,
        interface: connection.interface,
        authMethod: connection.authMethod,
        lastSuccessAt: ms(connection.lastSuccessAt),
        createdAt: connection.createdAt.getTime(),
        updatedAt: connection.updatedAt.getTime(),
      },
      capabilities: ctx.snapshots.capabilities(connection.id).map((row) => ({
        metricOrAction: row.metricOrAction,
        availability: row.availability,
        interface: row.interface,
        evidenceLevel: row.evidenceLevel,
        reason: row.reason,
        checkedAt: row.checkedAt.getTime(),
      })),
      snapshot: latest
        ? {
            observedAt: latest.snapshot.observedAt.getTime(),
            receivedAt: latest.snapshot.receivedAt.getTime(),
            connectorVersion: latest.snapshot.connectorVersion,
            metrics: latest.metrics.map(metricJson),
            resetCredits: latest.resetCredits.map(resetCreditJson),
          }
        : null,
      latestRun: run
        ? {
            startedAt: run.startedAt.getTime(),
            finishedAt: ms(run.finishedAt),
            outcome: run.outcome,
            sanitizedError: run.sanitizedError,
          }
        : null,
      actions: {
        enabled: ctx.actions.enabled,
        supported: ctx.actions.supported(connection.provider),
      },
    });
  });

  /**
   * Owner-triggered account mutation, for example consuming a Codex reset credit. Gated by
   * the owner's accountActions setting and by the literal confirm flag; never called by the scheduler.
   */
  app.post("/:id/actions", async (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "not_found" }, 404);
    const body = actionBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      const outcome = await ctx.actions.perform({
        connectionId: connection.id,
        action: body.data.action,
        confirm: body.data.confirm,
        ...(body.data.creditId ? { creditId: body.data.creditId } : {}),
      });
      return c.json({
        action: {
          id: outcome.action.id,
          action: outcome.action.action,
          state: outcome.action.state,
          requestedAt: outcome.action.requestedAt.getTime(),
          completedAt: ms(outcome.action.completedAt),
          providerReference: outcome.action.providerReference,
          sanitizedError: outcome.action.sanitizedError,
        },
        collection: outcome.collection ?? null,
        state: ctx.connections.get(connection.id)?.state,
      });
    } catch (error) {
      return handleServiceError(c, error);
    }
  });

  app.post("/:id/reconnect", async (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "not_found" }, 404);
    if (connection.state !== "reconnect_required")
      return c.json({ error: "reconnect_not_required" }, 409);
    const body = reconnectBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    try {
      const attempt = await ctx.connect.begin({
        provider: connection.provider,
        method: body.data.method,
        scope: connection.scope,
        connectionId: connection.id,
      });
      return c.json({ attempt }, 201);
    } catch (error) {
      return handleServiceError(c, error);
    }
  });

  /** Owner-set display name. Empty or null clears it. */
  app.patch("/:id", async (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "not_found" }, 404);
    const body = renameBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const name = body.data.name === "" ? null : body.data.name;
    ctx.connections.setDisplayName(connection.id, name);
    return c.json({ name });
  });

  app.post("/:id/pause", async (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "not_found" }, 404);
    const body = pauseBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    ctx.connections.setPaused(connection.id, body.data.paused);
    return c.json({ state: ctx.connections.get(connection.id)?.state });
  });

  /** Internal "Refresh now": one run under the same lease and limits as the scheduler. */
  app.post("/:id/refresh", async (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "not_found" }, 404);
    const outcome = await ctx.collection.run(connection.id, "manual");
    return c.json({ outcome, state: ctx.connections.get(connection.id)?.state });
  });

  /** Disconnect: provider revocation where documented, then delete everything local. */
  app.delete("/:id", async (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "not_found" }, 404);
    const connector = ctx.registry.get(connection.provider);
    const record = ctx.credentials.get(connection.id);
    let revocation: "revoked" | "local_only" | "failed" = "local_only";
    if (connector && record) {
      try {
        revocation = await connector.disconnect({
          secret: record.secret,
          expiresAt: record.expiresAt,
        });
      } catch {
        revocation = "failed";
      }
    }
    ctx.connections.delete(connection.id);
    return c.json({ revocation });
  });

  return app;
}
