import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";

import { defaultSettings } from "./settings-store.ts";
import { SettingsContext, SettingsProvider, useSettings, type SettingsValue } from "./settings.tsx";
import { When } from "./when.tsx";

function Probe() {
  const { settings, actionsEnabled, loaded } = useSettings();
  return <p>{`${settings.refreshIntervalMinutes}|${actionsEnabled}|${loaded}`}</p>;
}

const exactValue: SettingsValue = {
  settings: { ...defaultSettings, timeStyle: "exact", clock: "12h" },
  loaded: true,
  loadFailed: false,
  error: null,
  actionsEnabled: false,
  update: () => Promise.resolve(),
  reload: () => Promise.resolve(),
};

describe("When", () => {
  const soon = Date.now() + 52 * 60_000 + 30_000;
  test("countdown by default, with the exact time in the title", () => {
    const html = renderToString(<When at={soon} kind="until" prefix="Resets" />);
    expect(html).toContain("Resets in ");
    expect(html).toContain(">52 min</time>");
    expect(html).toContain('class="when"');
    expect(html).toContain(`dateTime="${new Date(soon).toISOString()}"`);
    expect(html).toMatch(/title="(Today · |[A-Z][a-z]{2}, )/);
  });
  test("exact style drops the in", () => {
    const html = renderToString(
      <SettingsContext.Provider value={exactValue}>
        <When at={soon} kind="until" prefix="Resets" />
      </SettingsContext.Provider>,
    );
    expect(html).not.toContain("Resets in");
    // Near midnight the time falls on the next day, which names the date instead of "at".
    expect(html).toMatch(
      /Resets <time[^>]*>(at|[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} ·) \d{1,2}:\d{2} (AM|PM)<\/time>/,
    );
    expect(html).toContain('title="52 min"');
  });
  test("ago without a prefix", () => {
    const html = renderToString(<When at={Date.now() - 12 * 60_000 - 5_000} kind="ago" />);
    expect(html).toContain(">12 min ago</time>");
  });
});

describe("settings context", () => {
  test("defaults without a provider", () => {
    expect(renderToString(<Probe />)).toBe("<p>15|false|false</p>");
  });
  test("the provider starts on the defaults before the first load", () => {
    const client = {
      settings: () => Promise.reject(new Error("not reached on the server")),
      saveSettings: () => Promise.reject(new Error("not reached on the server")),
    };
    const html = renderToString(
      <SettingsProvider client={client}>
        <Probe />
      </SettingsProvider>,
    );
    expect(html).toBe("<p>15|false|false</p>");
  });
});
