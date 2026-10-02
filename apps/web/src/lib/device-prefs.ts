import { useEffect, useState } from "react";

import { views, type ViewId } from "../router.ts";

/** Preferences that belong to this browser, not to the owner's server settings. */

export type Appearance = "system" | "light" | "dark";

export const appearanceKey = "headroom.appearance";
export const privacyKey = "headroom.privacy";
export const densityKey = "headroom.density";
export const sessionKey = "headroom.session";
export const viewKey = "headroom.view";

export interface PrefsRoot {
  readonly style: { colorScheme: string };
  toggleAttribute(name: string, force: boolean): boolean;
}

export interface DensityRoot {
  readonly dataset: Record<string, string | undefined>;
}

export type Density = "comfortable" | "compact";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function readAppearance(storage: ReadableStorage): Appearance {
  const value = storage.getItem(appearanceKey);
  return value === "light" || value === "dark" ? value : "system";
}

/** Hide Details is on unless the owner switched it off. */
export function readPrivacy(storage: ReadableStorage): boolean {
  return storage.getItem(privacyKey) !== "0";
}

export function applyAppearance(root: PrefsRoot, appearance: Appearance): void {
  root.style.colorScheme = appearance === "system" ? "" : appearance;
}

export function applyPrivacy(root: PrefsRoot, hidden: boolean): void {
  root.toggleAttribute("data-privacy", hidden);
}

export function readDensity(storage: ReadableStorage): Density | null {
  const value = storage.getItem(densityKey);
  return value === "comfortable" || value === "compact" ? value : null;
}

export function applyDensity(root: DensityRoot, density: Density): void {
  root.dataset["density"] = density;
}

export function saveDensity(storage: WritableStorage, density: Density): void {
  storage.setItem(densityKey, density);
}

/** This browser was signed in the last time it looked, so the first paint can be the dashboard frame. */
export function readSessionHint(storage: ReadableStorage): boolean {
  return storage.getItem(sessionKey) === "1";
}

export function saveSessionHint(storage: WritableStorage, signedIn: boolean): void {
  storage.setItem(sessionKey, signedIn ? "1" : "0");
}

/** The dashboard view this device showed last, or null when none was saved. */
export function readView(storage: ReadableStorage): ViewId | null {
  const value = storage.getItem(viewKey);
  return views.find((view) => view.id === value)?.id ?? null;
}

export function saveView(storage: WritableStorage, view: ViewId): void {
  storage.setItem(viewKey, view);
}

export function saveAppearance(storage: WritableStorage, appearance: Appearance): void {
  storage.setItem(appearanceKey, appearance);
}

export function savePrivacy(storage: WritableStorage, hidden: boolean): void {
  storage.setItem(privacyKey, hidden ? "1" : "0");
}

export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Apply what this browser remembers before React renders, so the first paint has the right look. */
export function applyStoredPrefs(
  root: PrefsRoot & DensityRoot,
  storage: ReadableStorage | null,
): void {
  if (storage === null) {
    applyPrivacy(root, true);
    return;
  }
  applyAppearance(root, readAppearance(storage));
  applyPrivacy(root, readPrivacy(storage));
  const density = readDensity(storage);
  if (density !== null) applyDensity(root, density);
}

interface DevicePrefs {
  readonly appearance: Appearance;
  readonly privacy: boolean;
  setAppearance(appearance: Appearance): void;
  setPrivacy(hidden: boolean): void;
}

export function useDevicePrefs(): DevicePrefs {
  const [appearance, setAppearanceState] = useState<Appearance>(() => {
    const storage = browserStorage();
    return storage === null ? "system" : readAppearance(storage);
  });
  const [privacy, setPrivacyState] = useState<boolean>(() => {
    const storage = browserStorage();
    return storage === null ? true : readPrivacy(storage);
  });
  useEffect(() => {
    applyAppearance(document.documentElement, appearance);
  }, [appearance]);
  useEffect(() => {
    applyPrivacy(document.documentElement, privacy);
  }, [privacy]);
  return {
    appearance,
    privacy,
    setAppearance(next) {
      setAppearanceState(next);
      const storage = browserStorage();
      if (storage !== null) saveAppearance(storage, next);
    },
    setPrivacy(next) {
      setPrivacyState(next);
      const storage = browserStorage();
      if (storage !== null) savePrivacy(storage, next);
    },
  };
}
