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
            percent: z.number().optional(),
            resets_at: z.string().nullable().optional(),
            scope: z
              .object({
                model: z.object({ display_name: z.string().optional() }).loose().optional(),
              })
              .loose()
              .optional(),
          })
          .loose(),
      )
      .optional(),
    extra_usage: z
      .object({
        is_enabled: z.boolean().optional(),
        /** Cents. */
        used_credits: z.number().optional(),
        /** Cents; 0 or absent means no cap. */
        monthly_limit: z.number().optional(),
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
                resets_left: z.number().optional(),
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
