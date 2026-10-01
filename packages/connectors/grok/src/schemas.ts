import { z } from "zod";

/**
 * `$GROK_HOME/auth.json`: a map of entries keyed by an opaque name. `key` is the access
 * token. Shape source-inspected in OpenUsage's GrokAuthStore.
 */
const authEntrySchema = z
  .object({
    key: z.string().min(1).optional(),
    refresh_token: z.string().min(1).optional(),
    refresh: z.string().min(1).optional(),
    id_token: z.string().optional(),
    expires_at: z.string().optional(),
    expires: z.string().optional(),
    oidc_client_id: z.string().optional(),
  })
  .loose();
export const authFileSchema = z.record(z.string(), authEntrySchema);

export const grokCredentialSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  idToken: z.string().nullable(),
  clientId: z.string().min(1),
});
export type GrokCredential = z.infer<typeof grokCredentialSchema>;

export const jwtClaimsSchema = z
  .object({
    exp: z.number().int().optional(),
    sub: z.string().optional(),
    email: z.string().optional(),
  })
  .loose();

export const refreshResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().optional(),
  expires_in: z.number().optional(),
});

/**
 * `GET /v1/billing?format=credits`. proto-JSON: zero-valued fields are omitted, so an absent
 * `creditUsagePercent` is a genuine 0 and an absent `onDemandCap` means disabled.
 */
export const billingResponseSchema = z.object({
  config: z
    .object({
      creditUsagePercent: z.number().optional(),
      currentPeriod: z.object({ type: z.string(), start: z.string(), end: z.string() }).loose(),
      onDemandCap: z.object({ val: z.number().optional() }).loose().optional(),
      /** Observed 2026-10-01: on-demand spend, prepaid balance and per-product percentages. */
      onDemandUsed: z.object({ val: z.number().optional() }).loose().optional(),
      prepaidBalance: z.object({ val: z.number().optional() }).loose().optional(),
      productUsage: z
        .array(z.object({ product: z.string(), usagePercent: z.number().optional() }).loose())
        .optional(),
      isUnifiedBillingUser: z.boolean().optional(),
    })
    .loose(),
});

export const settingsResponseSchema = z
  .object({ subscription_tier_display: z.string().optional() })
  .loose();
