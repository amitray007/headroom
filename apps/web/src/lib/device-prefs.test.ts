import { describe, expect, test } from "bun:test";

import {
  appearanceKey,
  applyAppearance,
  applyDemo,
  applyPrivacy,
  applyStoredPrefs,
  createDevicePrefsStore,
  demoKey,
  densityKey,
  readDemo,
  saveDemo,
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
  test("Privacy Mode is on unless stored as 0", () => {
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

describe("demo mode", () => {
  test("is off unless stored as 1", () => {
    expect(readDemo(store())).toBe(false);
    expect(readDemo(store({ [demoKey]: "0" }))).toBe(false);
    expect(readDemo(store({ [demoKey]: "yes" }))).toBe(false);
    expect(readDemo(store({ [demoKey]: "1" }))).toBe(true);
  });
  test("saves", () => {
    const s = store();
    saveDemo(s, true);
    expect(s.data.get("headroom.demo")).toBe("1");
    saveDemo(s, false);
    expect(s.data.get("headroom.demo")).toBe("0");
  });
  test("sets and clears the html attribute", () => {
    const el = root();
    applyDemo(el, true);
    expect(el.attributes.has("data-demo")).toBe(true);
    applyDemo(el, false);
    expect(el.attributes.has("data-demo")).toBe(false);
  });
});

function fullRoot() {
  return { ...root(), dataset: {} as Record<string, string | undefined> };
}

describe("stored prefs before first paint", () => {
  test("applies appearance, Privacy Mode and the last density", () => {
    const el = fullRoot();
    applyStoredPrefs(
      el,
      store({ [appearanceKey]: "dark", [privacyKey]: "0", [densityKey]: "compact" }),
    );
    expect(el.style.colorScheme).toBe("dark");
    expect(el.attributes.has("data-privacy")).toBe(false);
    expect(el.dataset["density"]).toBe("compact");
  });
  test("an empty browser turns Privacy Mode on, Demo Mode off, and leaves density to the stylesheet", () => {
    const el = fullRoot();
    applyStoredPrefs(el, store());
    expect(el.attributes.has("data-privacy")).toBe(true);
    expect(el.attributes.has("data-demo")).toBe(false);
    expect(el.dataset["density"]).toBeUndefined();
    expect(readDensity(store({ [densityKey]: "wide" }))).toBeNull();
  });
  test("no storage still turns Privacy Mode on", () => {
    const el = fullRoot();
    applyStoredPrefs(el, null);
    expect(el.attributes.has("data-privacy")).toBe(true);
    expect(el.attributes.has("data-demo")).toBe(false);
  });
  test("a stored Demo Mode marks the root and keeps the Privacy Mode blur, so nothing flashes", () => {
    const el = fullRoot();
    applyStoredPrefs(el, store({ [demoKey]: "1", [privacyKey]: "1" }));
    expect(el.attributes.has("data-demo")).toBe(true);
    expect(el.attributes.has("data-privacy")).toBe(true);
    applyStoredPrefs(el, store({ [demoKey]: "1", [privacyKey]: "0" }));
    expect(el.attributes.has("data-privacy")).toBe(false);
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

function setup(initial: Record<string, string> = {}) {
  const data = store(initial);
  const el = root();
  let clock = 1000;
  let draw = 0.25;
  const prefs = createDevicePrefsStore({
    storage: data,
    root: el,
    now: () => clock,
    random: () => draw,
  });
  return {
    data,
    el,
    prefs,
    tick: (next: number, nextDraw: number) => {
      clock = next;
      draw = nextDraw;
    },
  };
}

describe("device prefs store", () => {
  test("starts from storage: system, Privacy Mode on, Demo Mode off", () => {
    const { prefs } = setup();
    expect(prefs.getSnapshot()).toMatchObject({
      appearance: "system",
      privacy: true,
      demo: false,
      demoAnchor: 1000,
    });
  });
  test("every subscriber sees one change, and it is saved and applied", () => {
    const { prefs, data, el } = setup();
    const seen: boolean[][] = [[], []];
    const stops = [0, 1].map((index) =>
      prefs.subscribe(() => seen[index]?.push(prefs.getSnapshot().demo)),
    );
    prefs.setDemo(true);
    expect(seen).toEqual([[true], [true]]);
    expect(data.data.get(demoKey)).toBe("1");
    expect(el.attributes.has("data-demo")).toBe(true);
    // Demo identities blur like real ones while Privacy Mode is on.
    expect(prefs.getSnapshot().privacy).toBe(true);
    expect(el.attributes.has("data-privacy")).toBe(true);
    prefs.setDemo(false);
    expect(el.attributes.has("data-demo")).toBe(false);
    expect(el.attributes.has("data-privacy")).toBe(true);
    for (const stop of stops) stop();
    prefs.setPrivacy(false);
    expect(seen[0]).toEqual([true, false]);
    expect(data.data.get(privacyKey)).toBe("0");
  });
  test("Demo Mode takes a new seed and anchor each time it turns on, never saved", () => {
    const { prefs, data, tick } = setup();
    const first = prefs.getSnapshot();
    tick(5000, 0.75);
    prefs.setDemo(true);
    const second = prefs.getSnapshot();
    expect(second.demoAnchor).toBe(5000);
    expect(second.demoSeed).not.toBe(first.demoSeed);
    // Turning it off keeps the seed; setting it on again while on changes nothing.
    tick(9000, 0.5);
    prefs.setDemo(true);
    expect(prefs.getSnapshot()).toBe(second);
    prefs.setDemo(false);
    prefs.setDemo(true);
    expect(prefs.getSnapshot().demoSeed).not.toBe(second.demoSeed);
    expect([...data.data.keys()]).toEqual([demoKey]);
  });
  test("a stored Demo Mode is on at load with a fresh seed", () => {
    const { prefs } = setup({ [demoKey]: "1" });
    expect(prefs.getSnapshot().demo).toBe(true);
  });
  test("no storage and no root still work in memory", () => {
    const prefs = createDevicePrefsStore({
      storage: null,
      root: null,
      now: () => 1,
      random: () => 0,
    });
    prefs.setAppearance("dark");
    prefs.setDemo(true);
    expect(prefs.getSnapshot()).toMatchObject({ appearance: "dark", demo: true });
  });
});
