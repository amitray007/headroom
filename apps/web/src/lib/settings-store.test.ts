import { describe, expect, test } from "bun:test";

import type { Settings, SettingsEnvelope } from "../api.ts";
import {
  applyPatch,
  createSettingsStore,
  defaultSettings,
  type SettingsClient,
} from "./settings-store.ts";

const envelope = (settings: Settings): SettingsEnvelope => ({
  settings,
});

function fakeClient(options: { failSave?: boolean; stored?: Settings } = {}) {
  const saves: Settings[] = [];
  const client: SettingsClient = {
    settings: () => Promise.resolve(envelope(options.stored ?? defaultSettings)),
    saveSettings: async (settings) => {
      saves.push(settings);
      if (options.failSave === true) throw new Error("boom");
      return envelope(settings);
    },
  };
  return { client, saves };
}

describe("applyPatch", () => {
  test("merges notifications key by key", () => {
    const next = applyPatch(defaultSettings, {
      timeStyle: "exact",
      notifications: { runningLow: false },
    });
    expect(next.timeStyle).toBe("exact");
    expect(next.notifications).toEqual({ ...defaultSettings.notifications, runningLow: false });
    const lead = applyPatch(defaultSettings, { notifications: { resetLeadDays: 7 } });
    expect(lead.notifications.resetLeadDays).toBe(7);
    expect(lead.notifications.runningLow).toBe(true);
    expect(defaultSettings.notifications.runningLow).toBe(true);
  });
});

describe("defaults", () => {
  test("match the backend", () => {
    expect(defaultSettings).toEqual({
      limitsView: "used",
      lowThresholdPercent: 30,
      refreshIntervalMinutes: 15,
      timeStyle: "countdown",
      clock: "24h",
      density: "comfortable",
      detailedOrder: "urgency",
      keepInactiveLast: true,
      historyRetentionDays: 90,
      accountActions: false,
      walletCurrency: null,
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
  });
});

describe("store", () => {
  test("starts on defaults, then takes the server's settings", async () => {
    const stored = { ...defaultSettings, clock: "12h" } as const;
    const store = createSettingsStore(fakeClient({ stored }).client);
    expect(store.getState().loaded).toBe(false);
    expect(store.getState().settings).toEqual(defaultSettings);
    await store.load();
    expect(store.getState()).toEqual({
      settings: stored,
      loaded: true,
      loadFailed: false,
      error: null,
    });
  });

  test("a failed load keeps the defaults and says so", async () => {
    const store = createSettingsStore({
      settings: () => Promise.reject(new Error("down")),
      saveSettings: () => Promise.reject(new Error("down")),
    });
    await store.load();
    expect(store.getState().settings).toEqual(defaultSettings);
    expect(store.getState().loaded).toBe(true);
    expect(store.getState().loadFailed).toBe(true);
  });

  test("loading again after a failure clears it", async () => {
    let fail = true;
    const stored = { ...defaultSettings, clock: "12h" } as const;
    const store = createSettingsStore({
      settings: () =>
        fail ? Promise.reject(new Error("down")) : Promise.resolve({ settings: stored }),
      saveSettings: () => Promise.reject(new Error("down")),
    });
    await store.load();
    expect(store.getState().loadFailed).toBe(true);
    fail = false;
    await store.load();
    expect(store.getState().loadFailed).toBe(false);
    expect(store.getState().settings).toEqual(stored);
  });

  test("update shows at once and saves the full document", async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    await store.load();
    const done = store.update({ limitsView: "left" });
    expect(store.getState().settings.limitsView).toBe("left");
    await done;
    expect(fake.saves).toEqual([{ ...defaultSettings, limitsView: "left" }]);
    expect(store.getState().error).toBeNull();
  });

  test("a failed save rolls back with a message", async () => {
    const fake = fakeClient({ failSave: true });
    const store = createSettingsStore(fake.client);
    await store.load();
    await store.update({ density: "compact" });
    expect(store.getState().settings.density).toBe("comfortable");
    expect(store.getState().error).toBe("Could not save your settings. Nothing was changed.");
  });

  test("quick updates save in order and end on the newest", async () => {
    const fake = fakeClient();
    const store = createSettingsStore(fake.client);
    await store.load();
    void store.update({ clock: "12h" });
    await store.update({ lowThresholdPercent: 15 });
    expect(store.getState().settings).toEqual({
      ...defaultSettings,
      clock: "12h",
      lowThresholdPercent: 15,
    });
    expect(fake.saves.at(-1)).toEqual(store.getState().settings);
  });

  test("notifies subscribers", async () => {
    const store = createSettingsStore(fakeClient().client);
    let calls = 0;
    const stop = store.subscribe(() => (calls += 1));
    await store.update({ timeStyle: "exact" });
    expect(calls).toBeGreaterThan(0);
    const before = calls;
    stop();
    await store.update({ timeStyle: "countdown" });
    expect(calls).toBe(before);
  });
});
