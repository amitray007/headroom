import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { api } from "../api.ts";
import { applyDensity, browserStorage, saveDensity } from "./device-prefs.ts";
import {
  createSettingsStore,
  defaultSettings,
  type SettingsClient,
  type SettingsPatch,
  type SettingsState,
} from "./settings-store.ts";

export interface SettingsValue extends SettingsState {
  /** The owner switched account actions on in Settings. */
  readonly actionsEnabled: boolean;
  update(patch: SettingsPatch): Promise<void>;
  /** Load the settings again, after a failed first load. */
  reload(): Promise<void>;
}

const fallback: SettingsValue = {
  settings: defaultSettings,
  loaded: false,
  loadFailed: false,
  error: null,
  actionsEnabled: false,
  update: () => Promise.resolve(),
  reload: () => Promise.resolve(),
};

export const SettingsContext = createContext<SettingsValue>(fallback);

/** Settings and update helper. Without a provider it returns the defaults. */
export function useSettings(): SettingsValue {
  return useContext(SettingsContext);
}

interface ProviderProps {
  readonly children: ReactNode;
  /** Replaceable for tests. Defaults to the real API. */
  readonly client?: SettingsClient;
}

export function SettingsProvider({ children, client }: ProviderProps) {
  const [store] = useState(() => createSettingsStore(client ?? api));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => {
    void store.load();
  }, [store]);
  // Density is applied only from real settings, so the defaults never flash; the device keeps the last value for the next open.
  const { loaded, loadFailed } = state;
  const { density } = state.settings;
  useEffect(() => {
    if (!loaded || loadFailed) return;
    applyDensity(document.documentElement, density);
    const storage = browserStorage();
    if (storage !== null) saveDensity(storage, density);
  }, [loaded, loadFailed, density]);
  const value = useMemo<SettingsValue>(
    () => ({
      ...state,
      actionsEnabled: state.settings.accountActions,
      update: store.update,
      reload: store.load,
    }),
    [state, store],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
