import { z } from "zod";

import { currencySchema, providerSchema } from "./enums.ts";

/**
 * The owner-settings document's shape, with no database import so the browser can use it through
 * `contracts.ts`. `settings.ts` re-exports it next to the store that persists it.
 */

const refreshIntervalMinutes = z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]);
const lowThresholdPercent = z.union([z.literal(30), z.literal(20), z.literal(15)]);
const resetLeadDays = z.union([z.literal(1), z.literal(3), z.literal(7)]);

export const settingsSchema = z.object({
  limitsView: z.enum(["used", "left"]),
  /** Percent LEFT below which a limit reads "running low". Red stays under 10 percent left. */
  lowThresholdPercent,
  refreshIntervalMinutes,
  timeStyle: z.enum(["countdown", "exact"]),
  clock: z.enum(["24h", "12h"]),
  density: z.enum(["comfortable", "compact"]),
  /** How the Detailed view sorts when the owner has not picked an order there. Provider and custom orders follow the saved display order. */
  detailedOrder: z.enum(["urgency", "provider", "custom"]),
  /** The Detailed view keeps paused and disconnected accounts at the bottom. */
  keepInactiveLast: z.boolean(),
  /** Currency the Wallet totals in. Null until the owner picks one. */
  walletCurrency: currencySchema.nullable(),
  /** The owner's half of the account-actions gate; the server flag is the other half. */
  accountActions: z.boolean(),
  notifications: z.object({
    runningLow: z.boolean(),
    expiringResets: z.boolean(),
    refreshFailures: z.boolean(),
    /** Vercel AI Gateway credits running low. */
    balances: z.boolean(),
    /** Spend near or at its cap. */
    spend: z.boolean(),
    /** Limits on 5-hour session windows raise notices. Weekly and other windows always can. */
    includeSessions: z.boolean(),
    /** How many days before a banked reset expires the notice appears. */
    resetLeadDays,
    /** Providers whose notices are silenced. A broken sign-in is still shown. */
    mutedProviders: z.array(providerSchema),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;
