import { z } from "zod";

import {
  notificationAmountUnitSchema,
  notificationKindSchema,
  notificationToneSchema,
  providerSchema,
} from "./enums.ts";

/**
 * One notification as a self-contained event: what the browser renders today and what a server-side
 * delivery (Telegram, webhook) will send later. The shape is versioned and strict. It holds no email,
 * login or other personal identifier: the connection is named by its internal id and the owner's own
 * label. A figure that is unknown is left out, never zero. See docs/architecture/notifications.md.
 */

const amountSchema = z.strictObject({
  value: z.number().finite(),
  unit: notificationAmountUnitSchema,
});

const instant = z.number().int().nonnegative();

export const notificationEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** Stable dedupe key: the same situation keeps its id, the next period gets a new one. */
  id: z.string().min(1),
  kind: notificationKindSchema,
  tone: notificationToneSchema,
  /** When the situation was seen, epoch milliseconds. */
  occurredAt: instant,
  /** When Headroom last read the account, epoch milliseconds. */
  observedAt: instant,
  provider: providerSchema,
  connection: z.strictObject({
    id: z.string().min(1),
    /** The owner's name for the account, or its default scope word. */
    name: z.string().min(1),
    plan: z.string().nullable(),
  }),
  subject: z.strictObject({
    metricKey: z.string().nullable(),
    label: z.string().nullable(),
    window: z.string().nullable(),
  }),
  figures: z.strictObject({
    percentUsed: z.number().finite().optional(),
    percentLeft: z.number().finite().optional(),
    resetsAt: instant.optional(),
    /** The amount in question: spend so far, a balance, or an extra-usage count. */
    amount: amountSchema.optional(),
    /** What the amount counts against: a spending cap, or the total granted for a balance. */
    cap: amountSchema.optional(),
    expiresAt: instant.optional(),
  }),
  title: z.string().min(1),
  message: z.string().min(1),
  links: z.strictObject({ dashboard: z.url().optional() }),
});
export type NotificationEvent = z.infer<typeof notificationEventSchema>;
