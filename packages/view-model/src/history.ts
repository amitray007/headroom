import { accountEventSchema, syncRunOutcomeSchema } from "@headroom/core/contracts";
import { z } from "zod";

/**
 * Usage history for Analytics: what `GET /api/history` returns, and what Demo Mode makes up in the same shape.
 *
 * Units: `used` is percent of one limit window (0..100) and is never added across accounts. Instants are
 * milliseconds. An hour with no reading is absent, not zero; a refresh that failed is listed in `failures`.
 */

/** One hour of one limit: `[hour start, highest used percent read in that hour]`. */
export const historyPointSchema = z.tuple([z.number(), z.number()]);

/** A limit window seen in the stored readings. `start` is null when the provider reports only the reset. */
export const historyWindowSchema = z.object({
  start: z.number().nullable(),
  end: z.number(),
});

/** One limit of one account, keyed like the overview's metrics so the two line up. */
export const historySeriesSchema = z.object({
  providerMetricKey: z.string(),
  scope: z.string(),
  /** Hourly, oldest first; only hours that have a reading. */
  points: z.array(historyPointSchema),
  /** Every window the readings fall in, oldest first. */
  windows: z.array(historyWindowSchema),
});

export const historyConnectionSchema = z.object({
  id: z.string(),
  /** The span the stored readings cover; nulls when there is no reading yet. */
  coverage: z.object({
    firstAt: z.number().nullable(),
    lastAt: z.number().nullable(),
    readings: z.number().int().nonnegative(),
  }),
  series: z.array(historySeriesSchema),
  /** Refreshes that did not succeed, oldest first: each is a gap, never a zero. */
  failures: z.array(z.object({ at: z.number(), outcome: syncRunOutcomeSchema })),
  /** Account events in the range, oldest first: early resets, granted resets, top-ups. */
  events: z.array(accountEventSchema),
});

export const historySchema = z.object({
  from: z.number(),
  to: z.number(),
  /** Length of one bucket in `points`. */
  bucketMs: z.number().int().positive(),
  /** How long the server keeps history; a range longer than this can never fill. */
  retentionDays: z.number().int().positive(),
  connections: z.array(historyConnectionSchema),
});

export type HistoryPoint = z.infer<typeof historyPointSchema>;
export type HistoryWindow = z.infer<typeof historyWindowSchema>;
export type HistorySeries = z.infer<typeof historySeriesSchema>;
export type HistoryConnection = z.infer<typeof historyConnectionSchema>;
export type History = z.infer<typeof historySchema>;

/** The ranges Analytics asks for. */
export const historyDays = [7, 30, 90] as const;
