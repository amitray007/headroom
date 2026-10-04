import { z } from "zod";

export const cursorCredentialSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
});
export type CursorCredential = z.infer<typeof cursorCredentialSchema>;

export const tokenResponseSchema = z
  .object({ accessToken: z.string().min(1), refreshToken: z.string().min(1).optional() })
  .loose();

export const jwtClaimsSchema = z
  .object({ sub: z.string().optional(), exp: z.number().optional(), email: z.string().optional() })
  .loose();

const planUsageSchema = z
  .object({
    limit: z.number().nullable().optional(),
    includedSpend: z.number().nullable().optional(),
    totalSpend: z.number().nullable().optional(),
    remaining: z.number().nullable().optional(),
    totalPercentUsed: z.number().nullable().optional(),
    autoPercentUsed: z.number().nullable().optional(),
    apiPercentUsed: z.number().nullable().optional(),
  })
  .loose();

const spendLimitSchema = z
  .object({
    limitType: z.string().optional(),
    individualLimit: z.number().nullable().optional(),
    individualUsed: z.number().nullable().optional(),
    pooledLimit: z.number().nullable().optional(),
    pooledUsed: z.number().nullable().optional(),
  })
  .loose();

/**
 * `DashboardService/GetSandUsageStatus`: the Grok Bot allowance. Accounts on a pooled enterprise allowance or with no
 * included limit have no personal meter.
 */
export const grokBotUsageSchema = z
  .object({
    usagePercent: z.number().optional(),
    nextResetTimestampUtc: z.string().optional(),
    currentPeriodStart: z.string().optional(),
    usesPooledEnterpriseAllowance: z.boolean().optional(),
    hasNonZeroIncludedLimit: z.boolean().optional(),
    includedLimitZero: z.boolean().optional(),
  })
  .loose();
export type GrokBotUsage = z.infer<typeof grokBotUsageSchema>;

/** `DashboardService/GetCurrentPeriodUsage`. Money fields are cents. */
export const periodUsageSchema = z
  .object({
    billingCycleStart: z.string().optional(),
    billingCycleEnd: z.string().optional(),
    membershipType: z.string().optional(),
    enabled: z.boolean().optional(),
    isUnlimited: z.boolean().optional(),
    planUsage: planUsageSchema.optional(),
    spendLimitUsage: spendLimitSchema.optional(),
  })
  .loose();
export type PeriodUsage = z.infer<typeof periodUsageSchema>;
