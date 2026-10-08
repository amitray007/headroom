import { z } from "zod";

import {
  accountActionStateSchema,
  autoResetWindowSchema,
  notificationAmountUnitSchema,
} from "./enums.ts";

/**
 * Shapes for owner automations and detected account events, with no database import so the
 * browser can use them through `contracts.ts`. See docs/decisions/0003-owner-automations.md.
 */

const instant = z.number().int().nonnegative();
const percent = z.number().finite().min(0);

/** What one account event records. Numbers only: no provider text, response or credential. */
export const accountEventDetailSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    /** A banked reset credit that was not in the previous reading. */
    kind: z.literal("reset_granted"),
    creditId: z.string().min(1),
    expiresAt: instant.nullable(),
    /** Usable credits after the grant, when the provider reports a count. */
    available: z.number().int().nonnegative().nullable(),
  }),
  z.strictObject({
    /** A percent limit dropped to near zero before its reset time, with no action of Headroom's to explain it. */
    kind: z.literal("early_reset"),
    previousPercent: percent,
    percent,
    /** When the previous reading said the window would reset. */
    expectedResetAt: instant,
    /** True when a usable banked reset left the inventory between the same two readings. Absent otherwise. */
    bankedUsed: z.literal(true).optional(),
  }),
  z.strictObject({
    /** A credit balance rose. `added` is the rise in the provider's own unit. */
    kind: z.literal("top_up_detected"),
    unit: notificationAmountUnitSchema,
    previous: z.number().finite(),
    current: z.number().finite(),
    added: z.number().finite().positive(),
    /** The Wallet top-up recorded for it; null when recording failed or the balance is money (USD). */
    topUpId: z.string().min(1).nullable(),
  }),
  z.strictObject({
    /** An auto-reset rule fired. `state` is the action's final state. */
    kind: z.literal("auto_reset"),
    actionId: z.string().min(1),
    state: accountActionStateSchema.extract(["succeeded", "failed", "uncertain"]),
    creditId: z.string().min(1),
    /** The watched window's used percent that fired the rule, and when it would have reset on its own. */
    percent,
    resetsAt: instant,
  }),
]);
export type AccountEventDetail = z.infer<typeof accountEventDetailSchema>;

export const accountEventSchema = z.strictObject({
  id: z.string().min(1),
  connectionId: z.string().min(1),
  occurredAt: instant,
  /** The metric the event is about, or null for a reset credit. */
  metricKey: z.string().min(1).nullable(),
  detail: accountEventDetailSchema,
});
export type AccountEvent = z.infer<typeof accountEventSchema>;

/** Percent used that fires the rule. */
export const autoResetThresholds = [90, 95, 100] as const;
/** Hours the window's own reset must still be away, so a banked reset is not spent on a window about to reset anyway. */
export const autoResetMinHoursLeft = [1, 3, 6, 12, 24, 48] as const;

/**
 * One auto-reset rule per account. When a watched window is at least `thresholdPercent` used and
 * resets on its own more than `minHoursLeft` hours away, Headroom uses the usable banked reset
 * that expires first. At most one automatic attempt per window instance.
 */
export const autoResetRuleSchema = z.strictObject({
  enabled: z.boolean(),
  window: autoResetWindowSchema,
  thresholdPercent: z.union([z.literal(90), z.literal(95), z.literal(100)]),
  minHoursLeft: z.union([
    z.literal(1),
    z.literal(3),
    z.literal(6),
    z.literal(12),
    z.literal(24),
    z.literal(48),
  ]),
});
export type AutoResetRule = z.infer<typeof autoResetRuleSchema>;

export const defaultAutoResetRule: AutoResetRule = {
  enabled: false,
  window: "weekly",
  thresholdPercent: 100,
  minHoursLeft: 24,
};

/** The owner's own budget for one spend metric, in that metric's unit. */
export const spendBudgetSchema = z.strictObject({
  metricKey: z.string().min(1),
  amount: z.number().finite().positive(),
  unit: notificationAmountUnitSchema,
});
export type SpendBudget = z.infer<typeof spendBudgetSchema>;

/** `PUT /api/connections/:id/budgets/:metricKey`. The unit comes from the metric, not the request. */
export const spendBudgetInputSchema = z.strictObject({
  amount: z.number().finite().positive().max(1_000_000_000),
});
