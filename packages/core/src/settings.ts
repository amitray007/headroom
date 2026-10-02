import { eq } from "drizzle-orm";
import { z } from "zod";

import { type Db, schema } from "./db/index.ts";

/**
 * Owner preferences kept on the server so every browser agrees. One row, because Headroom has
 * one owner. The schema is the single list of keys: unknown stored keys are dropped on read,
 * missing or invalid ones take their default.
 */

const refreshIntervalOptions = [5, 10, 15, 30] as const;

const refreshIntervalMinutes = z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]);
const lowThresholdPercent = z.union([z.literal(30), z.literal(20), z.literal(15)]);

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
  /** The owner's half of the account-actions gate; the server flag is the other half. */
  accountActions: z.boolean(),
  notifications: z.object({
    runningLow: z.boolean(),
    expiringResets: z.boolean(),
    refreshFailures: z.boolean(),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

const ownerRow = "owner";

/** The allowed refresh option nearest to a configured interval in seconds. */
export function nearestRefreshMinutes(seconds: number): Settings["refreshIntervalMinutes"] {
  const minutes = seconds / 60;
  let best: Settings["refreshIntervalMinutes"] = refreshIntervalOptions[0];
  for (const option of refreshIntervalOptions) {
    if (Math.abs(option - minutes) < Math.abs(best - minutes)) best = option;
  }
  return best;
}

export function defaultSettings(refreshIntervalSeconds: number): Settings {
  return {
    limitsView: "used",
    lowThresholdPercent: 30,
    refreshIntervalMinutes: nearestRefreshMinutes(refreshIntervalSeconds),
    timeStyle: "countdown",
    clock: "24h",
    density: "comfortable",
    detailedOrder: "urgency",
    keepInactiveLast: true,
    accountActions: false,
    notifications: { runningLow: true, expiringResets: true, refreshFailures: true },
  };
}

function valid<T>(parser: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = parser.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

/** Merge stored JSON over the defaults, key by key, keeping only valid known values. */
export function mergeSettings(stored: unknown, defaults: Settings): Settings {
  const source = isRecord(stored) ? stored : {};
  const saved = isRecord(source["notifications"]) ? source["notifications"] : {};
  const shape = settingsSchema.shape;
  const flag = shape.accountActions;
  return {
    limitsView: valid(shape.limitsView, source["limitsView"], defaults.limitsView),
    lowThresholdPercent: valid(
      shape.lowThresholdPercent,
      source["lowThresholdPercent"],
      defaults.lowThresholdPercent,
    ),
    refreshIntervalMinutes: valid(
      shape.refreshIntervalMinutes,
      source["refreshIntervalMinutes"],
      defaults.refreshIntervalMinutes,
    ),
    timeStyle: valid(shape.timeStyle, source["timeStyle"], defaults.timeStyle),
    clock: valid(shape.clock, source["clock"], defaults.clock),
    density: valid(shape.density, source["density"], defaults.density),
    detailedOrder: valid(shape.detailedOrder, source["detailedOrder"], defaults.detailedOrder),
    keepInactiveLast: valid(flag, source["keepInactiveLast"], defaults.keepInactiveLast),
    accountActions: valid(flag, source["accountActions"], defaults.accountActions),
    notifications: {
      runningLow: valid(flag, saved["runningLow"], defaults.notifications.runningLow),
      expiringResets: valid(flag, saved["expiringResets"], defaults.notifications.expiringResets),
      refreshFailures: valid(
        flag,
        saved["refreshFailures"],
        defaults.notifications.refreshFailures,
      ),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SettingsStore {
  constructor(
    private readonly db: Db,
    private readonly refreshIntervalSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(): Settings {
    const defaults = defaultSettings(this.refreshIntervalSeconds);
    const row = this.db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.id, ownerRow))
      .get();
    if (!row) return defaults;
    try {
      return mergeSettings(JSON.parse(row.json), defaults);
    } catch {
      return defaults;
    }
  }

  /** Replace the whole document. The caller validated it with `settingsSchema`. */
  put(settings: Settings): Settings {
    const json = JSON.stringify(settings);
    const updatedAt = this.now();
    this.db
      .insert(schema.settings)
      .values({ id: ownerRow, json, updatedAt })
      .onConflictDoUpdate({ target: schema.settings.id, set: { json, updatedAt } })
      .run();
    return this.get();
  }
}
