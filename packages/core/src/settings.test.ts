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
      notifications: { runningLow: true, expiringResets: true, refreshFailures: true },
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
      runningLow: false,
      expiringResets: true,
      refreshFailures: true,
    });
    expect("legacy" in merged).toBe(false);
    expect(mergeSettings("junk", defaultSettings(900))).toEqual(defaultSettings(900));
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
