import { z } from "zod";

/** `$CLAUDE_CONFIG_DIR/.credentials.json` as written by Claude Code. */
export const credentialsFileSchema = z
  .object({
    claudeAiOauth: z
      .object({
        accessToken: z.string().min(1),
        refreshToken: z.string().min(1).optional(),
        /** Epoch milliseconds. */
        expiresAt: z.number().optional(),
        scopes: z.array(z.string()).optional(),
        subscriptionType: z.string().optional(),
        rateLimitTier: z.string().optional(),
      })
      .loose(),
  })
  .loose();

export const claudeCredentialSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  subscriptionType: z.string().nullable(),
  scopes: z.array(z.string()),
});
export type ClaudeCredential = z.infer<typeof claudeCredentialSchema>;

export const profileSchema = z
  .object({
    account: z.object({ uuid: z.string().min(1), email: z.string().optional() }).loose(),
    organization: z
      .object({ uuid: z.string().optional(), name: z.string().optional() })
      .loose()
      .optional(),
  })
  .loose();

export const refreshResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().optional(),
  })
  .loose();

const windowSchema = z
  .object({ utilization: z.number().optional(), resets_at: z.string().nullable().optional() })
  .loose();

/** `GET /api/oauth/usage?cedar_ember=1`. Loose: unknown fields stay out of the normalized output. */
export const usageResponseSchema = z
  .object({
    five_hour: windowSchema.nullable().optional(),
    seven_day: windowSchema.nullable().optional(),
    seven_day_sonnet: windowSchema.nullable().optional(),
    limits: z
      .array(
        z
          .object({
            kind: z.string().optional(),
            percent: z.number().nullable().optional(),
            resets_at: z.string().nullable().optional(),
            /** Null on the live response for unscoped kinds such as `session`. */
            scope: z
              .object({
                model: z.object({ display_name: z.string().optional() }).loose().optional(),
              })
              .loose()
              .nullable()
              .optional(),
          })
          .loose(),
      )
      .optional(),
    extra_usage: z
      .object({
        is_enabled: z.boolean().optional(),
        /** Cents; null on the live response while extra usage is disabled. */
        used_credits: z.number().nullable().optional(),
        /** Cents; null, 0 or absent means no cap. */
        monthly_limit: z.number().nullable().optional(),
      })
      .loose()
      .nullable()
      .optional(),
    cedar_ember: z
      .object({
        eligible: z.boolean().optional(),
        grants: z
          .array(
            z
              .object({
                /** `id` is the redemption handle; it is never parsed or stored. */
                label: z.string().nullable().optional(),
                resets_total: z.number().optional(),
                resets_left: z.number().optional(),
                starts_at: z.string().nullable().optional(),
                paused: z.boolean().optional(),
                usable_now: z.boolean().optional(),
                clears: z.array(z.string()).optional(),
                ends_at: z.string().nullable().optional(),
              })
              .loose(),
          )
          .optional(),
      })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();
export type UsageResponse = z.infer<typeof usageResponseSchema>;

const trancheSchema = z
  .object({
    remaining_amount_minor_units: z.number().optional(),
    /** Null on purchased credits that never expire. */
    expires_at: z.string().nullable().optional(),
  })
  .loose();

/**
 * `GET /api/oauth/organizations/{org}/prepaid/credits`. `amount` is the whole balance in minor units, promotional
 * credits included. Top-level fields validated 2026-10-08; the tranche element is source-inspected.
 */
export const prepaidCreditsSchema = z
  .object({
    amount: z.number(),
    currency: z.string().min(1),
    balance: z
      .object({
        money: z.object({ exponent: z.number().optional() }).loose().nullable().optional(),
      })
      .loose()
      .nullable()
      .optional(),
    next_expires_at: z.string().nullable().optional(),
    tranches: z.array(trancheSchema).optional(),
    promo_tranches: z.array(trancheSchema).optional(),
  })
  .loose();
