import { useSyncExternalStore } from "react";

import { views, type ViewId } from "../router.ts";

/** Preferences that belong to this browser, not to the owner's server settings. */

export type Appearance = "system" | "light" | "dark";

export const appearanceKey = "headroom.appearance";
export const privacyKey = "headroom.privacy";
export const demoKey = "headroom.demo";
export const densityKey = "headroom.density";
export const sessionKey = "headroom.session";
export const usernameKey = "headroom.username";
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

/** Privacy Mode is on unless the owner switched it off. */
export function readPrivacy(storage: ReadableStorage): boolean {
  return storage.getItem(privacyKey) !== "0";
}

/** Demo Mode is off unless the owner switched it on. */
export function readDemo(storage: ReadableStorage): boolean {
  return storage.getItem(demoKey) === "1";
}

export function applyAppearance(root: PrefsRoot, appearance: Appearance): void {
  root.style.colorScheme = appearance === "system" ? "" : appearance;
}

export function applyPrivacy(root: PrefsRoot, hidden: boolean): void {
  root.toggleAttribute("data-privacy", hidden);
}

export function applyDemo(root: PrefsRoot, on: boolean): void {
  root.toggleAttribute("data-demo", on);
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

/** The owner's username as last seen, so the boot frame can show the right avatar before the session loads. */
export function readUsername(storage: ReadableStorage): string | null {
  const value = storage.getItem(usernameKey);
  return value === null || value === "" ? null : value;
}

export function saveUsername(storage: WritableStorage, username: string): void {
  storage.setItem(usernameKey, username);
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

export function saveDemo(storage: WritableStorage, on: boolean): void {
  storage.setItem(demoKey, on ? "1" : "0");
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
    applyDemo(root, false);
    return;
  }
  const demo = readDemo(storage);
  applyAppearance(root, readAppearance(storage));
  applyPrivacy(root, readPrivacy(storage));
  applyDemo(root, demo);
  const density = readDensity(storage);
  if (density !== null) applyDensity(root, density);
}

export interface DevicePrefsState {
  readonly appearance: Appearance;
  /** The owner's Privacy Mode switch. It blurs identities in Demo Mode too, so a demo looks like the real app. */
  readonly privacy: boolean;
  readonly demo: boolean;
  /** Not saved: a new value on every page load and every time Demo Mode turns on. */
  readonly demoSeed: number;
  /** When this demo session began, so the made-up times stay put while the page re-renders. */
  readonly demoAnchor: number;
}

interface DevicePrefsActions {
  setAppearance: (appearance: Appearance) => void;
  setPrivacy: (on: boolean) => void;
  setDemo: (on: boolean) => void;
}

export interface DevicePrefsStore extends DevicePrefsActions {
  getSnapshot: () => DevicePrefsState;
  subscribe: (listener: () => void) => () => void;
}

interface DevicePrefsEnv {
  readonly storage: (ReadableStorage & WritableStorage) | null;
  readonly root: PrefsRoot | null;
  readonly now: () => number;
  readonly random: () => number;
}

/**
 * The device preferences outside React. Every reader sees the same values, each change is saved and applied to
 * the page root at once, and Demo Mode starts a new seed and anchor each time it turns on.
 */
export function createDevicePrefsStore(env: DevicePrefsEnv): DevicePrefsStore {
  const { storage, root } = env;
  const newSeed = (): number => Math.floor(env.random() * 0x1_0000_0000);
  const demo = storage !== null && readDemo(storage);
  let state: DevicePrefsState = {
    appearance: storage === null ? "system" : readAppearance(storage),
    privacy: storage === null ? true : readPrivacy(storage),
    demo,
    demoSeed: newSeed(),
    demoAnchor: env.now(),
  };
  const listeners = new Set<() => void>();
  const commit = (next: DevicePrefsState): void => {
    state = next;
    if (root !== null) {
      applyAppearance(root, next.appearance);
      applyPrivacy(root, next.privacy);
      applyDemo(root, next.demo);
    }
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setAppearance(appearance) {
      if (storage !== null) saveAppearance(storage, appearance);
      commit({ ...state, appearance });
    },
    setPrivacy(on) {
      if (storage !== null) savePrivacy(storage, on);
      commit({ ...state, privacy: on });
    },
    setDemo(on) {
      if (on === state.demo) return;
      if (storage !== null) saveDemo(storage, on);
      commit(
        on
          ? { ...state, demo: true, demoSeed: newSeed(), demoAnchor: env.now() }
          : { ...state, demo: false },
      );
    },
  };
}

let shared: DevicePrefsStore | null = null;

/** The one store for this page, created on first use from the browser's storage and root element. */
export function devicePrefs(): DevicePrefsStore {
  shared ??= createDevicePrefsStore({
    storage: browserStorage(),
    root: typeof document === "undefined" ? null : document.documentElement,
    now: Date.now,
    random: Math.random,
  });
  return shared;
}

export function useDevicePrefs(): DevicePrefsState & DevicePrefsActions {
  const store = devicePrefs();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    ...state,
    setAppearance: store.setAppearance,
    setPrivacy: store.setPrivacy,
    setDemo: store.setDemo,
  };
}
