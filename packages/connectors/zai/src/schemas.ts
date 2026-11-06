import { z } from "zod";

const secretText = z.string().trim().min(1).max(8192).regex(/^\S+$/);
const legacyCredentialSchema = z.object({
  apiKey: z.string().trim().min(1).max(8192).regex(/^\S+$/),
});
export const sessionSchema = z.object({
  kind: z.literal("oauth"),
  oauthAccessToken: secretText,
  accessToken: secretText,
  zcodeToken: secretText.optional(),
  accountId: z.string().trim().min(1).max(256),
  label: z.string().trim().min(1).max(256),
});
export const credentialSchema = z.union([sessionSchema, legacyCredentialSchema]);
const seconds = z.number().finite().positive().max(31_536_000);
export const initSchema = z.object({
  code: z.literal(0),
  data: z.object({
    flow_id: secretText,
    authorize_url: z.url().max(8192),
    expires_at: z.number().finite().positive().max(8_640_000_000_000),
    poll_interval_sec: seconds,
    poll_token: secretText.optional(),
  }),
});
export const attemptSchema = z.object({
  flowId: secretText,
  pollToken: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.number().finite().positive(),
  intervalMs: z.number().finite().min(1000).max(300000),
});
export const pollSchema = z.object({
  code: z.literal(0),
  data: z.discriminatedUnion("status", [
    z.object({ status: z.literal("pending") }),
    z.object({ status: z.literal("failed") }),
    z.object({
      status: z.literal("ready"),
      token: secretText,
      user: z.object({
        user_id: z.string().trim().min(1),
        name: z.string().trim().min(1).max(256).optional(),
        email: z.string().trim().min(1).max(256).optional(),
      }),
      zai: z.object({ access_token: secretText }),
    }),
  ]),
});
export const businessEnvelopeSchema = z.object({
  code: z.union([z.literal(0), z.literal(200), z.literal("0"), z.literal("200")]).nullish(),
  success: z.literal(true).optional(),
  data: z.unknown(),
});
export const authErrorSchema = z.object({
  code: z.union([
    z.literal(401),
    z.literal(1000),
    z.literal(1001),
    z.literal("401"),
    z.literal("1000"),
    z.literal("1001"),
  ]),
});
export const businessTokenSchema = z
  .object({
    access_token: secretText.optional(),
    accessToken: secretText.optional(),
    expires_in: seconds.nullish(),
  })
  .refine((value) => value.access_token !== undefined || value.accessToken !== undefined);
export const customerSchema = z.object({ customerNumber: z.string().trim().min(1).max(256) });
export const jwtExpirySchema = z.object({
  exp: z.number().finite().positive().max(8_640_000_000_000),
});
export const envelopeSchema = z.object({
  success: z.literal(true),
  code: z.literal(200),
  data: z.object({ limits: z.array(z.unknown()) }),
});
export const bucketSchema = z
  .object({
    type: z.string(),
    unit: z.number().int().positive(),
    number: z.number().int().positive().max(525600),
  })
  .loose();
export const percentSchema = z.number().finite().min(0).max(100);
export const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const resetSchema = z.number().int().positive().max(8_640_000_000_000_000);
export const countsSchema = z
  .object({
    usage: countSchema.positive(),
    currentValue: countSchema.optional(),
    remaining: countSchema.optional(),
  })
  .refine(
    (value) =>
      (value.currentValue !== undefined || value.remaining !== undefined) &&
      (value.remaining === undefined || value.remaining <= value.usage),
  );

export const resetInventoryEnvelopeSchema = z.object({
  code: z.literal(0),
  data: z.record(z.string(), z.unknown()),
});
export const resetCardsSchema = z.array(z.object({ expire_at: resetSchema }));
export const resetBusySchema = z.object({ code: z.literal(2007) });
