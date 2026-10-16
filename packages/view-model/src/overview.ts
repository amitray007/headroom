import {
  accountActionKindSchema,
  accountEventSchema,
  autoResetRuleSchema,
  authMethodSchema,
  availabilitySchema,
  connectionScopeSchema,
  connectionStateSchema,
  interfaceLabelSchema,
  metricKindSchema,
  providerSchema,
  reconnectReasonSchema,
  spendBudgetSchema,
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
export const paceSchema = z.object({
  metricKey: z.string(),
  /** Percentage points used per hour, from the first to the last reading of the trail. */
  ratePerHour: z.number().positive(),
  /** The first and last reading the rate is measured over, epoch milliseconds. */
  from: z.number(),
  to: z.number(),
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
  /** Account events from the last 7 days, newest first, at most 20 (ADR 0003). */
  events: z.array(accountEventSchema).default([]),
  /**
   * The recent burn rate of each percent limit, where Headroom can tell it from stored readings. A
   * limit without an entry has an unknown pace, never zero. See docs/architecture/notifications.md.
   */
  pace: z.array(paceSchema).default([]),
  /** The owner's auto-reset rule (null when none) and spend budgets for this account. */
  automation: z
    .object({
      autoReset: autoResetRuleSchema.nullable(),
      budgets: z.array(spendBudgetSchema),
    })
    .default({ autoReset: null, budgets: [] }),
});

export type Metric = z.infer<typeof metricSchema>;
export type ResetCredit = z.infer<typeof resetCreditSchema>;
export type OverviewConnection = z.infer<typeof overviewConnectionSchema>;
export type Pace = z.infer<typeof paceSchema>;
