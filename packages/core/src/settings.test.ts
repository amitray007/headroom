import { describe, expect, test } from "bun:test";

import { openDatabase } from "./db/index.ts";
import {
  defaultSettings,
  mergeSettings,
  nearestRefreshMinutes,
  SettingsStore,
  settingsSchema,
} from "./settings.ts";

describe("settings", () => {
  test("defaults, with the refresh option nearest to the configured interval", () => {
    expect(defaultSettings(900)).toEqual({
      limitsView: "used",
      lowThresholdPercent: 30,
      refreshIntervalMinutes: 15,
      timeStyle: "countdown",
      clock: "24h",
      density: "comfortable",
      detailedOrder: "urgency",
      keepInactiveLast: true,
      accountActions: false,
      notifications: {
        runningLow: true,
        expiringResets: true,
        refreshFailures: true,
        balances: true,
        spend: true,
        includeSessions: true,
        resetLeadDays: 3,
        mutedProviders: [],
      },
    });
    expect(nearestRefreshMinutes(60)).toBe(5);
    expect(nearestRefreshMinutes(600)).toBe(10);
    expect(nearestRefreshMinutes(1500)).toBe(30);
    expect(nearestRefreshMinutes(86_400)).toBe(30);
  });

  test("unknown stored keys are dropped, missing and invalid ones take defaults", () => {
    const merged = mergeSettings(
      { clock: "12h", density: "tiny", legacy: true, notifications: { runningLow: false } },
      defaultSettings(900),
    );
    expect(merged.clock).toBe("12h");
    expect(merged.density).toBe("comfortable");
    expect(merged.detailedOrder).toBe("urgency");
    expect(merged.keepInactiveLast).toBe(true);
    expect(merged.notifications).toEqual({
      ...defaultSettings(900).notifications,
      runningLow: false,
    });
    expect("legacy" in merged).toBe(false);
    expect(mergeSettings("junk", defaultSettings(900))).toEqual(defaultSettings(900));
  });

  test("the notification keys keep valid stored values and drop invalid ones", () => {
    const merged = mergeSettings(
      {
        notifications: {
          includeSessions: false,
          resetLeadDays: 7,
          mutedProviders: ["codex", "grok"],
          balances: false,
          spend: "yes",
          extra: 1,
        },
      },
      defaultSettings(900),
    );
    expect(merged.notifications).toEqual({
      ...defaultSettings(900).notifications,
      includeSessions: false,
      resetLeadDays: 7,
      mutedProviders: ["codex", "grok"],
      balances: false,
    });
    const bad = mergeSettings(
      { notifications: { resetLeadDays: 2, mutedProviders: ["codex", "nope"] } },
      defaultSettings(900),
    );
    expect(bad.notifications.resetLeadDays).toBe(3);
    expect(bad.notifications.mutedProviders).toEqual([]);
    expect(settingsSchema.safeParse({ ...defaultSettings(900), notifications: {} }).success).toBe(
      false,
    );
  });

  test("the store returns defaults, then the saved document", () => {
    const { db } = openDatabase({ path: ":memory:" });
    const store = new SettingsStore(db, 900);
    expect(store.get()).toEqual(defaultSettings(900));
    const next = { ...defaultSettings(900), limitsView: "left" as const, accountActions: true };
    expect(store.put(next)).toEqual(next);
    expect(store.put({ ...next, clock: "12h" }).clock).toBe("12h");
    expect(new SettingsStore(db, 900).get().limitsView).toBe("left");
  });

  test("the Detailed view settings keep valid stored values and drop invalid ones", () => {
    const merged = mergeSettings(
      { detailedOrder: "custom", keepInactiveLast: false },
      defaultSettings(900),
    );
    expect([merged.detailedOrder, merged.keepInactiveLast]).toEqual(["custom", false]);
    const bad = mergeSettings(
      { detailedOrder: "random", keepInactiveLast: "no" },
      defaultSettings(900),
    );
    expect([bad.detailedOrder, bad.keepInactiveLast]).toEqual(["urgency", true]);
  });

  test("the schema rejects values outside the options", () => {
    const base = defaultSettings(900);
    expect(settingsSchema.safeParse({ ...base, refreshIntervalMinutes: 7 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base, lowThresholdPercent: 10 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base, detailedOrder: "name" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...base, extra: 1 }).success).toBe(true);
  });
});
