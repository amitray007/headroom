import { createContext, useContext } from "react";

/** The Settings dialog sections a page can open at. */
export type SettingsSection = "detailed";

/** Opens the Settings dialog, scrolled to a section when one is named. */
export type OpenSettings = (section?: SettingsSection) => void;

export const OpenSettingsContext = createContext<OpenSettings>(() => {});

export function useOpenSettings(): OpenSettings {
  return useContext(OpenSettingsContext);
}
