import { z } from "zod";

/** Shapes of every response and file the connector reads. A parse failure is `invalid_response`. */

/** `$CODEX_HOME/auth.json` as written by the official CLI. OPENAI_API_KEY logins are not accepted. */
export const authFileSchema = z.object({
  tokens: z.object({
    id_token: z.string().min(1),
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    account_id: z.string().min(1).optional(),
  }),
  last_refresh: z.string().optional(),
});

/** The credential Headroom stores, derived from the auth file or a refresh. */
export const codexCredentialSchema = z.object({
  idToken: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accountId: z.string().min(1).nullable(),
});
export type CodexCredential = z.infer<typeof codexCredentialSchema>;

/** Claims in the OpenAI id token. Only the fields Headroom reads. */
export const idTokenClaimsSchema = z.object({
  exp: z.number().int(),
  email: z.string().optional(),
  "https://api.openai.com/auth": z
    .object({
      chatgpt_account_id: z.string().optional(),
      chatgpt_plan_type: z.string().optional(),
      chatgpt_user_id: z.string().optional(),
      user_id: z.string().optional(),
    })
    .optional(),
});

export const accessTokenClaimsSchema = z.object({ exp: z.number().int() });

export const refreshResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
});

export const refreshErrorSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const windowSchema = z
  .object({
    used_percent: z.number().optional(),
    limit_window_seconds: z.number().int().optional(),
    reset_at: z.number().optional(),
    reset_after_seconds: z.number().optional(),
  })
  .loose();

/** Windows are null when the plan has only one; observed 2026-10-01 on a Pro account. */
const rateLimitSchema = z
  .object({
    primary_window: windowSchema.nullable().optional(),
    secondary_window: windowSchema.nullable().optional(),
  })
  .loose();

/** `GET /wham/usage`. Loose everywhere: unknown fields are kept out of the normalized output, not rejected. */
export const usageResponseSchema = z
  .object({
    plan_type: z.string().optional(),
    rate_limit: rateLimitSchema.nullable().optional(),
    /** Null, not an empty array, when no model-specific limit applies (observed 2026-10-01). */
    additional_rate_limits: z
      .array(
        z
          .object({
            limit_name: z.string().optional(),
            metered_feature: z.string().optional(),
            rate_limit: rateLimitSchema.nullable().optional(),
          })
          .loose(),
      )
      .nullable()
      .optional(),
    credits: z
      .object({
        balance: z.union([z.number(), z.string()]).optional(),
        has_credits: z.boolean().optional(),
        unlimited: z.boolean().optional(),
      })
      .loose()
      .optional(),
    rate_limit_reset_credits: z
      .object({ available_count: z.number().int().optional() })
      .loose()
      .optional(),
  })
  .loose();
export type UsageResponse = z.infer<typeof usageResponseSchema>;

/** `GET /wham/rate-limit-reset-credits`. Validated 2026-10-01: id, status, expiry, type and title per credit. */
export const resetCreditsResponseSchema = z
  .object({
    available_count: z.number().int().optional(),
    credits: z
      .array(
        z
          .object({
            id: z.string().optional(),
            status: z.string().optional(),
            expires_at: z.union([z.number(), z.string()]).nullable().optional(),
            reset_type: z.string().nullable().optional(),
            title: z.string().nullable().optional(),
            redeemed_at: z.union([z.number(), z.string()]).nullable().optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

/** `POST /wham/rate-limit-reset-credits/consume`. Loose; the binary names `windows_reset` on the response. */
export const consumeResetCreditResponseSchema = z
  .object({ windows_reset: z.unknown().optional() })
  .loose();
