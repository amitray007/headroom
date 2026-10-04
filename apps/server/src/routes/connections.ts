import { Hono } from "hono";
import { z } from "zod";

import {
  accountActionKindSchema,
  authMethodSchema,
  autoResetRuleSchema,
  notificationAmountUnitSchema,
  spendBudgetInputSchema,
  type DisconnectResult,
} from "@headroom/core";

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

  /**
   * The owner's auto-reset rule (ADR 0003). Only providers whose connector can consume a reset
   * credit take one. The rule fires later, from the scheduler, and only with Allow Account Actions on.
   */
  app.put("/:id/auto-reset", async (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "unknown_connection" }, 404);
    const body = autoResetRuleSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    if (!ctx.actions.supported(connection.provider).includes("consume_reset_credit"))
      return c.json({ error: "unsupported_action" }, 409);
    ctx.automation.setAutoReset(connection.id, body.data);
    return c.json({ autoReset: ctx.automation.autoReset(connection.id) });
  });

  app.delete("/:id/auto-reset", (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "unknown_connection" }, 404);
    ctx.automation.clearAutoReset(connection.id);
    return c.json({ autoReset: null });
  });

  /** A budget for one spend metric. The unit is the metric's own, read from the latest snapshot. */
  app.put("/:id/budgets/:metricKey", async (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "unknown_connection" }, 404);
    const body = spendBudgetInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const metricKey = c.req.param("metricKey");
    const metric = ctx.snapshots
      .latest(connection.id)
      ?.metrics.find((m) => m.kind === "spend" && m.providerMetricKey === metricKey);
    const unit = notificationAmountUnitSchema.safeParse(metric?.unit);
    if (!metric || !unit.success) return c.json({ error: "not_a_spend_metric" }, 409);
    ctx.automation.setBudget(connection.id, metricKey, body.data.amount, unit.data);
    return c.json({ budgets: ctx.automation.budgets(connection.id) });
  });

  app.delete("/:id/budgets/:metricKey", (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "unknown_connection" }, 404);
    ctx.automation.clearBudget(connection.id, c.req.param("metricKey"));
    return c.json({ budgets: ctx.automation.budgets(connection.id) });
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
    // No fixed holder: the lease re-grants to the same holder, so a shared name would let two
    // concurrent refreshes both collect and rotate the refresh token twice.
    const outcome = await ctx.collection.run(connection.id);
    return c.json({ outcome, state: ctx.connections.get(connection.id)?.state });
  });

  /**
   * Disconnect: provider revocation where documented, then delete everything local. Runs under
   * the connection's lease, waiting briefly for a collection in flight, so the delete never
   * pulls the connection out from under it.
   */
  app.delete("/:id", async (c) => {
    const connection = ctx.connections.get(c.req.param("id"));
    if (!connection) return c.json({ error: "not_found" }, 404);
    const holder = `disconnect:${Bun.randomUUIDv7()}`;
    let acquired: boolean;
    try {
      acquired = await ctx.leases.acquireWithin(
        connection.id,
        holder,
        ctx.collection.leaseTtlMs,
        ctx.disconnectWaitMs,
      );
    } catch (error) {
      // Deleted by another request while this one waited.
      if (!ctx.connections.get(connection.id)) return c.json({ error: "not_found" }, 404);
      throw error;
    }
    if (!acquired) return c.json({ error: "connection_busy" }, 409);
    try {
      const connector = ctx.registry.get(connection.provider);
      const record = ctx.credentials.get(connection.id);
      let revocation: DisconnectResult = "local_only";
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
    } finally {
      // The delete cascades to the lease row; this covers a failure before it.
      ctx.leases.release(connection.id, holder);
    }
  });

  return app;
}
