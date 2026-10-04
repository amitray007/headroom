import { eq } from "drizzle-orm";
import type { z } from "zod";

import { type Db, schema } from "./db/index.ts";
import { settingsSchema, type Settings } from "./settings-schema.ts";

export { settingsSchema, type Settings };

/**
 * Owner preferences kept on the server so every browser agrees. One row, because Headroom has
 * one owner. The schema is the single list of keys: unknown stored keys are dropped on read,
 * missing or invalid ones take their default.
 */

const refreshIntervalOptions = [5, 10, 15, 30] as const;

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
    walletCurrency: null,
    historyRetentionDays: 90,
    accountActions: false,
    notifications: {
      runningLow: true,
      expiringResets: true,
      refreshFailures: true,
      balances: true,
      spend: true,
      resetActivity: true,
      includeSessions: true,
      resetLeadDays: 3,
      mutedProviders: [],
    },
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
  const notify = shape.notifications.shape;
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
    walletCurrency: valid(shape.walletCurrency, source["walletCurrency"], defaults.walletCurrency),
    historyRetentionDays: valid(
      shape.historyRetentionDays,
      source["historyRetentionDays"],
      defaults.historyRetentionDays,
    ),
    accountActions: valid(flag, source["accountActions"], defaults.accountActions),
    notifications: {
      runningLow: valid(flag, saved["runningLow"], defaults.notifications.runningLow),
      expiringResets: valid(flag, saved["expiringResets"], defaults.notifications.expiringResets),
      refreshFailures: valid(
        flag,
        saved["refreshFailures"],
        defaults.notifications.refreshFailures,
      ),
      balances: valid(flag, saved["balances"], defaults.notifications.balances),
      spend: valid(flag, saved["spend"], defaults.notifications.spend),
      resetActivity: valid(flag, saved["resetActivity"], defaults.notifications.resetActivity),
      includeSessions: valid(
        flag,
        saved["includeSessions"],
        defaults.notifications.includeSessions,
      ),
      resetLeadDays: valid(
        notify.resetLeadDays,
        saved["resetLeadDays"],
        defaults.notifications.resetLeadDays,
      ),
      mutedProviders: valid(
        notify.mutedProviders,
        saved["mutedProviders"],
        defaults.notifications.mutedProviders,
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
