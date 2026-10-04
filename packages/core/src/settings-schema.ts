import { z } from "zod";

import {
  currencySchema,
  notificationKindSchema,
  notificationKinds,
  providerSchema,
} from "./enums.ts";

/**
 * The owner-settings document's shape, with no database import so the browser can use it through
 * `contracts.ts`. `settings.ts` re-exports it next to the store that persists it.
 */

const refreshIntervalMinutes = z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]);
const lowThresholdPercent = z.union([z.literal(30), z.literal(20), z.literal(15)]);
const resetLeadDays = z.union([z.literal(1), z.literal(3), z.literal(7)]);
const historyRetentionDays = z.union([
  z.literal(30),
  z.literal(90),
  z.literal(180),
  z.literal(365),
]);

/** One boolean per notification kind. Zod checks that every kind is present. */
const kindSwitchesSchema = z.record(notificationKindSchema, z.boolean());
export type KindSwitches = z.infer<typeof kindSwitchesSchema>;

/** Every kind set to one value. */
export function kindSwitches(value: boolean): KindSwitches {
  return kindSwitchesSchema.parse(
    Object.fromEntries(notificationKinds.map((kind) => [kind, value])),
  );
}

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
  /** How long refresh history is kept. The newest reading of each account is kept whatever its age. */
  historyRetentionDays,
  /** The owner's half of the account-actions gate; the server flag is the other half. */
  accountActions: z.boolean(),
  notifications: z.object({
    /** One switch per notification kind. Every kind goes to the bell and to each enabled channel. */
    kinds: kindSwitchesSchema,
    /** Limits on 5-hour session windows raise notices. Weekly and other windows always can. */
    includeSessions: z.boolean(),
    /** How many days before a banked reset expires the notice appears. */
    resetLeadDays,
    /** Providers whose notices are silenced. A broken sign-in is still shown. */
    mutedProviders: z.array(providerSchema),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;
