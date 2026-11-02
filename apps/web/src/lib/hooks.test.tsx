import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { devicePrefs, useDevicePrefs } from "./device-prefs.ts";
import { defaultSettings } from "./settings-store.ts";
import { SettingsContext, type SettingsValue } from "./settings.tsx";
import { connection, percent } from "@headroom/view-model/test-fixtures";
import { readKey } from "@headroom/view-model/notifications";
import { useNotifications } from "./use-notifications.ts";

function Prefs() {
  const prefs = useDevicePrefs();
  return <p>{`${prefs.appearance}|${prefs.privacy}|${prefs.demo}`}</p>;
}

const claude = [connection("claude", { metrics: [percent("seven_day", 95)] })];

const loadedSettings: SettingsValue = {
  settings: defaultSettings,
  loaded: true,
  loadFailed: false,
  error: null,
  actionsEnabled: false,
  update: () => Promise.resolve(),
  reload: () => Promise.resolve(),
};
const loadingSettings: SettingsValue = { ...loadedSettings, loaded: false };

function Bell(props: { readonly connections: typeof claude | null; readonly failed?: boolean }) {
  const view = useNotifications(props.connections, props.failed);
  return <p>{`${view.status}|${view.unread}|${view.items.map((item) => item.title).join(",")}`}</p>;
}

function DemoBell() {
  const view = useNotifications(claude, false, 3);
  return <p>{`${view.status}|${view.unread}|${view.items.map((item) => item.title).join(",")}`}</p>;
}

function Ids(props: { readonly demoSeed: number | null }) {
  const view = useNotifications(claude, false, props.demoSeed);
  return <p>{`${view.unread}|${view.items.map((item) => item.id).join(",")}`}</p>;
}

function renderIds(seed: number | null): string {
  return renderToString(
    <WithSettings loaded>
      <Ids demoSeed={seed} />
    </WithSettings>,
  );
}

function WithSettings(props: { readonly loaded: boolean; readonly children: ReactNode }) {
  return (
    <SettingsContext.Provider value={props.loaded ? loadedSettings : loadingSettings}>
      {props.children}
    </SettingsContext.Provider>
  );
}

describe("hooks without a browser store", () => {
  test("device prefs start on system appearance, Privacy Mode on, Demo Mode off", () => {
    expect(renderToString(<Prefs />)).toBe("<p>system|true|false</p>");
  });
  test("two components read the same device prefs after a change", () => {
    const prefs = devicePrefs();
    prefs.setDemo(true);
    prefs.setPrivacy(false);
    try {
      expect(
        renderToString(
          <>
            <Prefs />
            <Prefs />
          </>,
        ),
      ).toBe("<p>system|false|true</p><p>system|false|true</p>");
    } finally {
      prefs.setDemo(false);
      prefs.setPrivacy(true);
    }
  });
  test("notifications wait for the overview and the settings, then list what is derived", () => {
    const html = (connections: typeof claude | null, loaded: boolean, failed = false) =>
      renderToString(
        <WithSettings loaded={loaded}>
          <Bell connections={connections} failed={failed} />
        </WithSettings>,
      );
    expect(html(null, true)).toBe("<p>loading|0|</p>");
    expect(html(claude, false)).toBe("<p>loading|0|</p>");
    expect(html(null, true, true)).toBe("<p>unavailable|0|</p>");
    // The read marks come from the server, so a first render with no effects still waits for them.
    expect(html(claude, true)).toBe("<p>loading|0|</p>");
  });
  test("Demo Mode lists what is derived without waiting for the server", () => {
    expect(
      renderToString(
        <WithSettings loaded>
          <DemoBell />
        </WithSettings>,
      ),
    ).toBe("<p>ready|1|Claude Is Almost Out of Its Weekly Limit</p>");
  });
  test("real notifications wait for the server's read marks; Demo Mode does not", () => {
    // The shared store has not loaded in a render without effects, so the real list is still loading.
    expect(renderIds(null)).toBe("<p>0|</p>");
    expect(renderIds(7)).toMatch(/^<p>1\|.+<\/p>$/);
  });
  test("Demo Mode ignores the ids this browser saved before the server kept them", () => {
    const id = renderIds(7)
      .replace(/^<p>\d+\|/, "")
      .replace(/<\/p>$/, "");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: (key: string) => (key === readKey ? JSON.stringify([id]) : null) },
    });
    try {
      expect(renderIds(7)).toBe(`<p>1|${id}</p>`);
    } finally {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
