import { describe, expect, test } from "bun:test";

import { openDatabase } from "./db/index.ts";
import { kindSwitches } from "./settings-schema.ts";
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
      walletCurrency: null,
      historyRetentionDays: 90,
      accountActions: false,
      providers: {},
      notifications: {
        kinds: kindSwitches(true),
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

  test("provider display choices keep valid entries and drop an invalid document", () => {
    const defaults = defaultSettings(900);
    expect(mergeSettings({}, defaults).providers).toEqual({});
    expect(
      mergeSettings({ providers: { claude: { hideZeroBalance: true } } }, defaults).providers,
    ).toEqual({ claude: { hideZeroBalance: true } });
    expect(
      mergeSettings({ providers: { claude: { hideZeroBalance: "yes" } } }, defaults).providers,
    ).toEqual({});
    expect(
      mergeSettings({ providers: { nobody: { hideZeroBalance: true } } }, defaults).providers,
    ).toEqual({});
  });

  test("walletCurrency is null when missing or invalid and kept when valid", () => {
    const defaults = defaultSettings(900);
    expect(mergeSettings({}, defaults).walletCurrency).toBeNull();
    expect(mergeSettings({ walletCurrency: "XXX" }, defaults).walletCurrency).toBeNull();
    expect(mergeSettings({ walletCurrency: "EUR" }, defaults).walletCurrency).toBe("EUR");
    expect(settingsSchema.safeParse({ ...defaults, walletCurrency: "INR" }).success).toBe(true);
  });

  test("history retention defaults to 90 days, also for a document stored before the field", () => {
    const defaults = defaultSettings(900);
    expect(mergeSettings({ clock: "12h" }, defaults).historyRetentionDays).toBe(90);
    expect(mergeSettings({ historyRetentionDays: 45 }, defaults).historyRetentionDays).toBe(90);
    expect(mergeSettings({ historyRetentionDays: 365 }, defaults).historyRetentionDays).toBe(365);
    for (const days of [30, 90, 180, 365]) {
      expect(settingsSchema.safeParse({ ...defaults, historyRetentionDays: days }).success).toBe(
        true,
      );
    }
    for (const days of [0, 7, 45, "90", null]) {
      expect(settingsSchema.safeParse({ ...defaults, historyRetentionDays: days }).success).toBe(
        false,
      );
    }
  });

  test("a stored document without the field loads with 90 days", () => {
    const { db, sqlite } = openDatabase({ path: ":memory:" });
    const store = new SettingsStore(db, 900);
    const { historyRetentionDays: _drop, ...older } = store.get();
    store.put({ ...older, historyRetentionDays: 180 });
    expect(store.get().historyRetentionDays).toBe(180);
    sqlite.run("UPDATE settings SET json = ?", [JSON.stringify(older)]);
    expect(store.get().historyRetentionDays).toBe(90);
    sqlite.close();
  });

  test("unknown stored keys are dropped, missing and invalid ones take defaults", () => {
    const merged = mergeSettings(
      { clock: "12h", density: "tiny", legacy: true, notifications: { includeSessions: false } },
      defaultSettings(900),
    );
    expect(merged.clock).toBe("12h");
    expect(merged.density).toBe("comfortable");
    expect(merged.detailedOrder).toBe("urgency");
    expect(merged.keepInactiveLast).toBe(true);
    expect(merged.notifications).toEqual({
      ...defaultSettings(900).notifications,
      includeSessions: false,
    });
    expect("legacy" in merged).toBe(false);
    expect(mergeSettings("junk", defaultSettings(900))).toEqual(defaultSettings(900));
  });

  test("old group switches carry over to the kinds they covered", () => {
    const merged = mergeSettings(
      {
        notifications: {
          runningLow: false,
          spend: false,
          refreshFailures: false,
          kinds: { almost_out: true, budget_near: true },
        },
      },
      defaultSettings(900),
    );
    const off = Object.entries(merged.notifications.kinds)
      .filter(([, on]) => !on)
      .map(([kind]) => kind)
      .toSorted();
    expect(off).toEqual(
      [
        "running_low",
        "spend_near_cap",
        "spend_cap_reached",
        "extra_usage_started",
        "budget_exceeded",
        "refresh_failed",
        "disconnected",
      ].toSorted(),
    );
    expect(merged.notifications.kinds.almost_out).toBe(true);
    expect(merged.notifications.kinds.budget_near).toBe(true);
    expect("runningLow" in merged.notifications).toBe(false);
    expect(mergeSettings({}, defaultSettings(900)).notifications.kinds).toEqual(
      defaultSettings(900).notifications.kinds,
    );
  });

  test("the notification keys keep valid stored values and drop invalid ones", () => {
    const merged = mergeSettings(
      {
        notifications: {
          includeSessions: false,
          resetLeadDays: 7,
          mutedProviders: ["codex", "grok"],
          kinds: { balance_low: false, budget_near: "yes", nonsense: false },
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
      kinds: { ...defaultSettings(900).notifications.kinds, balance_low: false },
    });
    expect("nonsense" in merged.notifications.kinds).toBe(false);
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
