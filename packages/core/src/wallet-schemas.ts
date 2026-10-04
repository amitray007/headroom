import { z } from "zod";

import { billingCycleSchema, currencySchema, topUpKindSchema, topUpSourceSchema } from "./enums.ts";

/**
 * The Wallet's data shapes, with no database import so the browser can use them through
 * `contracts.ts`. `wallet.ts` re-exports everything here next to the store that persists it.
 */

/** A real calendar day as `YYYY-MM-DD`: 2026-02-30 is rejected. */
export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "not a calendar day");

/** An amount in minor units (cents, paise, whole yen) with its currency. */
export const moneySchema = z.object({
  minor: z.number().int().positive().safe(),
  currency: currencySchema,
});
export type WalletMoney = z.infer<typeof moneySchema>;

export const costSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("paid"),
    price: moneySchema,
    cycle: billingCycleSchema,
    renewsOn: calendarDaySchema.nullable(),
  }),
  z.object({ kind: z.literal("free") }),
  z.object({
    kind: z.literal("included"),
    includedWith: z.string().trim().min(1).max(80),
  }),
]);
export type Cost = z.infer<typeof costSchema>;

/** Days before a top-up's credits expire that the owner wants a notice. */
export const expiryAlertDayOptions = [7, 14, 30] as const;
const expiryAlertDaysSchema = z.union([z.literal(7), z.literal(14), z.literal(30)]);

const topUpEditable = z.object({
  date: calendarDaySchema,
  kind: topUpKindSchema,
  price: moneySchema.nullable(),
  credits: z.number().positive().finite().nullable(),
  note: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .transform((note) => (note === null || note === "" ? null : note)),
  /** The day the credits expire, when they do. */
  expiresOn: calendarDaySchema.nullable().default(null),
  /** Notify this many days before `expiresOn`. Null means no notice. */
  expiryAlertDays: expiryAlertDaysSchema.nullable().default(null),
});
const topUpFields = topUpEditable.extend({ connectionId: z.string().min(1) });

function priceMatchesKind(value: { kind: "paid" | "free"; price: WalletMoney | null }): boolean {
  return value.kind === "paid" ? value.price !== null : value.price === null;
}
const priceMessage = "A paid top-up needs a price; a free one has none.";

/** A detected top-up may be paid with its price not yet entered; a free one never has a price. */
function priceFitsSource(value: {
  kind: "paid" | "free";
  price: WalletMoney | null;
  source: "owner" | "detected";
}): boolean {
  return value.source === "detected" && value.kind === "paid" ? true : priceMatchesKind(value);
}

function alertNeedsExpiry(value: { expiresOn: string | null; expiryAlertDays: number | null }) {
  return value.expiryAlertDays === null || value.expiresOn !== null;
}
const alertMessage = "An expiry notice needs an expiry day.";

/** `POST /api/wallet/top-ups`: always an owner entry. */
export const topUpInputSchema = topUpFields
  .refine(priceMatchesKind, priceMessage)
  .refine(alertNeedsExpiry, alertMessage);
export type TopUpInput = z.infer<typeof topUpInputSchema>;

/**
 * `PUT /api/wallet/top-ups/:id`: replaces the editable fields; the account and source stay. The
 * price may stay empty on a paid top-up only when it was detected; the server checks the source.
 */
export const topUpUpdateSchema = topUpEditable.refine(alertNeedsExpiry, alertMessage);
export type TopUpUpdate = z.infer<typeof topUpUpdateSchema>;

export const topUpSchema = topUpFields
  .extend({ id: z.string().min(1), source: topUpSourceSchema })
  .refine(priceFitsSource, priceMessage)
  .refine(alertNeedsExpiry, alertMessage);
export type TopUp = z.infer<typeof topUpSchema>;
