import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";

import { useDevicePrefs } from "./device-prefs.ts";
import { defaultSettings } from "./settings-store.ts";
import { SettingsContext, type SettingsValue } from "./settings.tsx";
import { connection, percent } from "@headroom/view-model/test-fixtures";
import { useNotifications } from "./use-notifications.ts";

function Prefs() {
  const prefs = useDevicePrefs();
  return <p>{`${prefs.appearance}|${prefs.privacy}`}</p>;
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

function WithSettings(props: { readonly loaded: boolean; readonly children: ReactNode }) {
  return (
    <SettingsContext.Provider value={props.loaded ? loadedSettings : loadingSettings}>
      {props.children}
    </SettingsContext.Provider>
  );
}

describe("hooks without a browser store", () => {
  test("device prefs start on system appearance with details hidden", () => {
    expect(renderToString(<Prefs />)).toBe("<p>system|true</p>");
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
    expect(html(claude, true)).toBe("<p>ready|1|Claude Is Almost Out of Its Weekly Limit</p>");
  });
});
