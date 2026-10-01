import { z } from "zod";

export const copilotCredentialSchema = z.object({ token: z.string().min(1) });

export const deviceCodeResponseSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.url(),
  expires_in: z.number(),
  interval: z.number().optional(),
});

export const accessTokenResponseSchema = z.union([
  z.object({ access_token: z.string().min(1) }).loose(),
  z.object({ error: z.string(), error_description: z.string().optional() }).loose(),
]);

/** `~/.config/github-copilot/apps.json`: keyed by `github.com:<app id>`, each with `oauth_token`. */
export const appsFileSchema = z.record(
  z.string(),
  z.object({ oauth_token: z.string().min(1), user: z.string().optional() }).loose(),
);

export const userSchema = z.object({ id: z.number(), login: z.string().min(1) }).loose();

const snapshotSchema = z
  .object({
    entitlement: z.number().optional(),
    remaining: z.number().optional(),
    percent_remaining: z.number().optional(),
    unlimited: z.boolean().optional(),
    overage_count: z.number().optional(),
    overage_permitted: z.boolean().optional(),
    credits_used: z.number().optional(),
  })
  .loose();

/** `GET /copilot_internal/user`. Loose: unknown fields stay out of the normalized output. */
export const usageResponseSchema = z
  .object({
    copilot_plan: z.string().optional(),
    quota_reset_date: z.string().nullable().optional(),
    token_based_billing: z.boolean().optional(),
    quota_snapshots: z
      .object({
        premium_interactions: snapshotSchema.optional(),
        chat: snapshotSchema.optional(),
        completions: snapshotSchema.optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
export type UsageResponse = z.infer<typeof usageResponseSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
