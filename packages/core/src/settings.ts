import { eq } from "drizzle-orm";
import type { z } from "zod";

import { type Db, schema } from "./db/index.ts";
import { notificationKinds, type NotificationKind } from "./enums.ts";
import {
  kindSwitches,
  settingsSchema,
  type KindSwitches,
  type Settings,
} from "./settings-schema.ts";

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
      kinds: kindSwitches(true),
      includeSessions: true,
      resetLeadDays: 3,
      mutedProviders: [],
    },
  };
}

/** The kinds each old group switch covered, for documents saved before every kind had its own. */
const legacyGroups: Record<string, readonly NotificationKind[]> = {
  runningLow: ["running_low", "almost_out"],
  expiringResets: ["reset_expiring"],
  balances: ["balance_low", "top_up_detected", "credits_expiring"],
  spend: [
    "spend_near_cap",
    "spend_cap_reached",
    "extra_usage_started",
    "budget_near",
    "budget_exceeded",
  ],
  resetActivity: ["reset_granted", "early_reset", "auto_reset"],
  refreshFailures: ["refresh_failed", "disconnected"],
};

/** Each kind takes its own stored flag, then its old group flag, then the default. */
function mergeKinds(saved: Record<string, unknown>, defaults: KindSwitches): KindSwitches {
  const stored = isRecord(saved["kinds"]) ? saved["kinds"] : {};
  const kinds = { ...defaults };
  for (const kind of notificationKinds) {
    const own = typeof stored[kind] === "boolean" ? stored[kind] : undefined;
    if (own !== undefined) {
      kinds[kind] = own;
      continue;
    }
    for (const [group, covered] of Object.entries(legacyGroups)) {
      const old = saved[group];
      if (covered.includes(kind) && typeof old === "boolean") kinds[kind] = old;
    }
  }
  return kinds;
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
      kinds: mergeKinds(saved, defaults.notifications.kinds),
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
