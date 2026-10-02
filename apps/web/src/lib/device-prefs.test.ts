import { describe, expect, test } from "bun:test";

import {
  appearanceKey,
  applyAppearance,
  applyPrivacy,
  applyStoredPrefs,
  densityKey,
  readDensity,
  readSessionHint,
  readUsername,
  saveUsername,
  usernameKey,
  readView,
  saveView,
  viewKey,
  saveSessionHint,
  sessionKey,
  privacyKey,
  readAppearance,
  readPrivacy,
  saveAppearance,
  savePrivacy,
} from "./device-prefs.ts";

function store(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

function root() {
  const attributes = new Set<string>();
  return {
    style: { colorScheme: "" },
    attributes,
    toggleAttribute(name: string, force: boolean) {
      if (force) attributes.add(name);
      else attributes.delete(name);
      return force;
    },
  };
}

describe("appearance", () => {
  test("defaults to system and ignores junk", () => {
    expect(readAppearance(store())).toBe("system");
    expect(readAppearance(store({ [appearanceKey]: "sepia" }))).toBe("system");
    expect(readAppearance(store({ [appearanceKey]: "dark" }))).toBe("dark");
    expect(readAppearance(store({ [appearanceKey]: "light" }))).toBe("light");
  });
  test("applies a colour scheme, system clears it", () => {
    const el = root();
    applyAppearance(el, "dark");
    expect(el.style.colorScheme).toBe("dark");
    applyAppearance(el, "system");
    expect(el.style.colorScheme).toBe("");
  });
  test("saves", () => {
    const s = store();
    saveAppearance(s, "light");
    expect(s.data.get("headroom.appearance")).toBe("light");
  });
});

describe("privacy", () => {
  test("Hide Details is on unless stored as 0", () => {
    expect(readPrivacy(store())).toBe(true);
    expect(readPrivacy(store({ [privacyKey]: "1" }))).toBe(true);
    expect(readPrivacy(store({ [privacyKey]: "0" }))).toBe(false);
  });
  test("sets and clears the html attribute", () => {
    const el = root();
    applyPrivacy(el, true);
    expect(el.attributes.has("data-privacy")).toBe(true);
    applyPrivacy(el, false);
    expect(el.attributes.has("data-privacy")).toBe(false);
  });
  test("saves", () => {
    const s = store();
    savePrivacy(s, false);
    expect(s.data.get("headroom.privacy")).toBe("0");
    savePrivacy(s, true);
    expect(s.data.get("headroom.privacy")).toBe("1");
  });
});

function fullRoot() {
  return { ...root(), dataset: {} as Record<string, string | undefined> };
}

describe("stored prefs before first paint", () => {
  test("applies appearance, hidden details and the last density", () => {
    const el = fullRoot();
    applyStoredPrefs(
      el,
      store({ [appearanceKey]: "dark", [privacyKey]: "0", [densityKey]: "compact" }),
    );
    expect(el.style.colorScheme).toBe("dark");
    expect(el.attributes.has("data-privacy")).toBe(false);
    expect(el.dataset["density"]).toBe("compact");
  });
  test("an empty browser hides details and leaves density to the stylesheet", () => {
    const el = fullRoot();
    applyStoredPrefs(el, store());
    expect(el.attributes.has("data-privacy")).toBe(true);
    expect(el.dataset["density"]).toBeUndefined();
    expect(readDensity(store({ [densityKey]: "wide" }))).toBeNull();
  });
  test("no storage still hides details", () => {
    const el = fullRoot();
    applyStoredPrefs(el, null);
    expect(el.attributes.has("data-privacy")).toBe(true);
  });
  test("the session hint is only true after a sign-in was seen", () => {
    const data = store();
    expect(readSessionHint(data)).toBe(false);
    saveSessionHint(data, true);
    expect(data.data.get(sessionKey)).toBe("1");
    expect(readSessionHint(data)).toBe(true);
    saveSessionHint(data, false);
    expect(readSessionHint(data)).toBe(false);
  });
  test("the remembered username is read back, and empty means none", () => {
    const data = store();
    expect(readUsername(data)).toBeNull();
    saveUsername(data, "ada");
    expect(readUsername(data)).toBe("ada");
    expect(readUsername(store({ [usernameKey]: "" }))).toBeNull();
  });
  test("the remembered view is one of the known views", () => {
    const data = store();
    expect(readView(data)).toBeNull();
    saveView(data, "compare");
    expect(data.data.get(viewKey)).toBe("compare");
    expect(readView(data)).toBe("compare");
    expect(readView(store({ [viewKey]: "gone" }))).toBeNull();
  });
});
