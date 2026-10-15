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

/**
 * The wire form of one series: `points` as runs of bucket steps and values, which halves the response. `start` is
 * the first point's hour; each step counts buckets from the point before (the first is 0). The two arrays have the
 * same length.
 */
const historyWireSeriesSchema = historySeriesSchema
  .omit({ points: true })
  .extend({
    start: z.number(),
    steps: z.array(z.number().int().nonnegative()),
    values: z.array(z.number()),
  })
  .refine((series) => series.steps.length === series.values.length, {
    message: "steps and values differ in length",
  });

type HistoryWireSeries = z.infer<typeof historyWireSeriesSchema>;

/** What `GET /api/history` sends. It parses to a `History`. */
export const historyWireSchema = historySchema
  .omit({ connections: true })
  .extend({
    connections: z.array(
      historyConnectionSchema.omit({ series: true }).extend({
        series: z.array(historyWireSeriesSchema),
      }),
    ),
  })
  .transform((wire): History => ({
    ...wire,
    connections: wire.connections.map((connection) => ({
      ...connection,
      series: connection.series.map(({ start, steps, values, ...series }) => {
        let at = start;
        return {
          ...series,
          points: values.map((value, i): HistoryPoint => {
            at += (steps[i] ?? 0) * wire.bucketMs;
            return [at, value];
          }),
        };
      }),
    })),
  }));

/** A history in its wire form; `historyWireSchema` turns it back. */
export function encodeHistory(history: History): z.input<typeof historyWireSchema> {
  return {
    ...history,
    connections: history.connections.map((connection) => ({
      ...connection,
      series: connection.series.map(({ points, ...series }): HistoryWireSeries => {
        const start = points[0]?.[0] ?? 0;
        let previous = start;
        const steps: number[] = [];
        const values: number[] = [];
        for (const [at, value] of points) {
          steps.push(Math.round((at - previous) / history.bucketMs));
          values.push(value);
          previous = at;
        }
        return { ...series, start, steps, values };
      }),
    })),
  };
}
