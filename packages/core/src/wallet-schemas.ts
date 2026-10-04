import { z } from "zod";

import { billingCycleSchema, currencySchema, topUpKindSchema } from "./enums.ts";

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

const topUpFields = z.object({
  connectionId: z.string().min(1),
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
});

function priceMatchesKind(value: { kind: "paid" | "free"; price: WalletMoney | null }): boolean {
  return value.kind === "paid" ? value.price !== null : value.price === null;
}
const priceMessage = "A paid top-up needs a price; a free one has none.";

export const topUpInputSchema = topUpFields.refine(priceMatchesKind, priceMessage);
export type TopUpInput = z.infer<typeof topUpInputSchema>;

export const topUpSchema = topUpFields
  .extend({ id: z.string().min(1) })
  .refine(priceMatchesKind, priceMessage);
export type TopUp = z.infer<typeof topUpSchema>;
