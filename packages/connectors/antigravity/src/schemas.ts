import { z } from "zod";

export const antigravityCredentialSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
  email: z.string().nullable(),
  subject: z.string().nullable(),
});
export type AntigravityCredential = z.infer<typeof antigravityCredentialSchema>;

export const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1).optional(),
    expires_in: z.number().optional(),
    id_token: z.string().optional(),
  })
  .loose();

export const userInfoSchema = z
  .object({ id: z.string().min(1), email: z.string().optional() })
  .loose();

const bucketSchema = z
  .object({
    bucketId: z.string().optional(),
    remainingFraction: z.number().optional(),
    resetTime: z.string().nullable().optional(),
  })
  .loose();
const groupsSchema = z
  .object({
    groups: z.array(z.object({ buckets: z.array(bucketSchema).optional() }).loose()).optional(),
  })
  .loose();

/** `retrieveUserQuotaSummary`: either `{groups}` or `{response: {groups}}`. */
export const quotaSummarySchema = z.union([
  groupsSchema.extend({ response: groupsSchema.optional() }),
  z.object({ response: groupsSchema }),
]);

export const loadCodeAssistSchema = z
  .object({
    cloudaicompanionProject: z.string().optional(),
    currentTier: z.object({ name: z.string().optional() }).loose().optional(),
    paidTier: z.object({ name: z.string().optional() }).loose().optional(),
  })
  .loose();
