import {
  accountActionKindSchema,
  authMethodSchema,
  availabilitySchema,
  connectionScopeSchema,
  connectionStateSchema,
  interfaceLabelSchema,
  metricKindSchema,
  providerSchema,
  reconnectReasonSchema,
  syncRunOutcomeSchema,
} from "@headroom/core/contracts";
import { z } from "zod";

/** The overview shapes the dashboard and the notification derivation both read. */

export const metricSchema = z.object({
  providerMetricKey: z.string(),
  kind: metricKindSchema,
  scope: z.string(),
  valueText: z.string().nullable(),
  valueNum: z.number().nullable(),
  unit: z.string(),
  unlimited: z.boolean().nullable().optional(),
  windowStart: z.number().nullable(),
  windowEnd: z.number().nullable(),
  resetsAt: z.number().nullable(),
  availability: availabilitySchema,
  interface: interfaceLabelSchema,
});
export const resetCreditSchema = z.object({
  providerCreditId: z.string(),
  eligible: z.boolean(),
  usable: z.boolean(),
  expiresAt: z.number().nullable(),
  cooldownUntil: z.number().nullable(),
  rawLabel: z.string().nullable(),
});
export const overviewConnectionSchema = z.object({
  id: z.string(),
  provider: providerSchema,
  scope: connectionScopeSchema,
  state: connectionStateSchema,
  reconnectReason: reconnectReasonSchema.nullable(),
  interface: interfaceLabelSchema,
  authMethod: authMethodSchema,
  name: z.string().nullable(),
  identity: z.string().nullable(),
  plan: z.string().nullable(),
  createdAt: z.number(),
  lastSuccessAt: z.number().nullable(),
  stale: z.boolean(),
  latestRun: z
    .object({
      startedAt: z.number(),
      finishedAt: z.number().nullable(),
      outcome: syncRunOutcomeSchema.nullable(),
      error: z.string().nullable(),
      failureStreak: z.number().int().nonnegative(),
    })
    .nullable(),
  snapshot: z
    .object({
      observedAt: z.number(),
      metrics: z.array(metricSchema),
      resetCredits: z.array(resetCreditSchema),
    })
    .nullable(),
  actions: z.object({ enabled: z.boolean(), supported: z.array(accountActionKindSchema) }),
});

export type Metric = z.infer<typeof metricSchema>;
export type ResetCredit = z.infer<typeof resetCreditSchema>;
export type OverviewConnection = z.infer<typeof overviewConnectionSchema>;
