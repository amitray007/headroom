import type { Settings, SettingsEnvelope } from "../api.ts";

/** The same defaults the backend uses before the owner saves anything. */
export const defaultSettings: Settings = {
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
    resetActivity: true,
    includeSessions: true,
    resetLeadDays: 3,
    mutedProviders: [],
  },
};

export type SettingsPatch = Partial<Omit<Settings, "notifications">> & {
  notifications?: Partial<Settings["notifications"]>;
};

export function applyPatch(settings: Settings, patch: SettingsPatch): Settings {
  const { notifications, ...rest } = patch;
  return {
    ...settings,
    ...rest,
    notifications: { ...settings.notifications, ...notifications },
  };
}

export interface SettingsState {
  readonly settings: Settings;
  /** True once the first load finished, whether or not it worked. */
  readonly loaded: boolean;
  /** The first load failed, so the settings shown are the defaults and saving is not safe yet. */
  readonly loadFailed: boolean;
  /** A plain sentence about the last failure, for the settings dialog. Cleared by the next change. */
  readonly error: string | null;
}

export interface SettingsClient {
  settings: () => Promise<SettingsEnvelope>;
  saveSettings: (settings: Settings) => Promise<SettingsEnvelope>;
}

export interface SettingsStore {
  getState: () => SettingsState;
  subscribe: (listener: () => void) => () => void;
  load: () => Promise<void>;
  update: (patch: SettingsPatch) => Promise<void>;
}

const same = (a: Settings, b: Settings): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settings state outside React. `update` applies the change at once, saves the full document,
 * and puts the last saved settings back with an error message when the save fails. Saves run
 * one after another so the server always ends on the newest accepted state.
 */
export function createSettingsStore(client: SettingsClient): SettingsStore {
  let state: SettingsState = {
    settings: defaultSettings,
    loaded: false,
    loadFailed: false,
    error: null,
  };
  let saved: Settings = defaultSettings;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const save = async (): Promise<void> => {
    const wanted = state.settings;
    if (same(wanted, saved)) return;
    try {
      const envelope = await client.saveSettings(wanted);
      saved = envelope.settings;
      if (same(state.settings, wanted)) set({ settings: envelope.settings });
    } catch {
      set({ settings: saved, error: "Could not save your settings. Nothing was changed." });
    }
  };

  const set = (next: Partial<SettingsState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async load() {
      try {
        const envelope = await client.settings();
        saved = envelope.settings;
        set({
          settings: envelope.settings,
          loaded: true,
          loadFailed: false,
          error: null,
        });
      } catch {
        set({ loaded: true, loadFailed: true, error: null });
      }
    },
    update(patch) {
      set({ settings: applyPatch(state.settings, patch), error: null });
      queue = queue.then(save);
      return queue;
    },
  };
}
