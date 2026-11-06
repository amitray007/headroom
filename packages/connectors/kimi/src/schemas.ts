import { z } from "zod";

export const regionSchema = z.enum(["global", "mainland-cn"]);
const secretText = z.string().trim().min(1).max(8192).regex(/^\S+$/);
const legacyCredentialSchema = z.object({
  apiKey: z.string().trim().min(1).max(8192).regex(/^\S+$/),
  region: regionSchema.default("global"),
});
export const oauthCredentialSchema = z.object({
  kind: z.literal("oauth"),
  region: regionSchema,
  accessToken: secretText,
  refreshToken: secretText,
  deviceId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9-]+$/),
});
export const credentialSchema = z.union([oauthCredentialSchema, legacyCredentialSchema]);
const secondsSchema = z
  .union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/)])
  .transform(Number)
  .pipe(z.number().finite().positive().max(31_536_000));
export const deviceResponseSchema = z.object({
  device_code: secretText,
  user_code: z.string().min(1).max(256),
  verification_uri_complete: z.url().max(8192),
  expires_in: secondsSchema.nullish(),
  interval: secondsSchema.pipe(z.number().max(300)).default(5),
});
export const tokenResponseSchema = z.object({
  access_token: secretText,
  refresh_token: secretText,
  expires_in: secondsSchema,
});
export const oauthErrorSchema = z.object({ error: z.string() });
export const regionAttemptSchema = z.object({
  stage: z.literal("region"),
  expiresAt: z.number(),
  deviceId: z.string(),
});
export const deviceAttemptSchema = z.object({
  stage: z.literal("device"),
  expiresAt: z.number(),
  deviceId: z.string(),
  region: regionSchema,
  deviceCode: secretText,
  intervalMs: z.number().positive(),
});
export const profileSchema = z.object({
  user_id: z.string().trim().min(1),
  email: z.string().trim().min(1).catch("").optional(),
  nickname: z.string().trim().min(1).catch("").optional(),
  user_level_name: z.string().trim().min(1).catch("").optional(),
});
/** Numeric strings occur in both client generations; empty strings and booleans are not numbers. */
const numeric = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/),
  ])
  .transform(Number)
  .pipe(z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER));
export const ratioSchema = numeric.pipe(z.number().max(1));
export const objectSchema = z.record(z.string(), z.unknown());
export const resetSchema = z.iso.datetime({ offset: true });
export const legacyCountSchema = z
  .object({
    limit: numeric.pipe(z.number().positive()),
    used: numeric.optional(),
    remaining: numeric.optional(),
  })
  .refine(
    (value) =>
      (value.used !== undefined || value.remaining !== undefined) &&
      (value.used === undefined || value.used <= value.limit) &&
      (value.remaining === undefined || value.remaining <= value.limit),
  );
export const legacyWindowSchema = z.object({
  duration: numeric.pipe(z.number().positive()),
  timeUnit: z.enum(["TIME_UNIT_SECOND", "TIME_UNIT_MINUTE", "TIME_UNIT_HOUR", "TIME_UNIT_DAY"]),
});
