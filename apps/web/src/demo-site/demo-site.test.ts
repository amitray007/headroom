import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { providers } from "@headroom/core/contracts";

import { api, isDemoRefusal } from "../api.ts";
import { defaultSettings } from "../lib/settings-store.ts";
import { handleDemoRequest, resetDemoApi } from "./api.ts";
import { isEmbedded, parseSiteMessage } from "./embed.ts";
import { createDemoFetch } from "./fetch.ts";

const origin = "https://example.test";
const realFetch = globalThis.fetch;
let passed: string[] = [];

beforeEach(() => {
  passed = [];
  resetDemoApi();
  const passthrough = Object.assign(
    (input: string | URL | Request) => {
      passed.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(new Response("passed"));
    },
    { preconnect: realFetch.preconnect },
  );
  globalThis.fetch = createDemoFetch(passthrough, origin);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function refused(call: Promise<unknown>): Promise<boolean> {
  try {
    await call;
    return false;
  } catch (cause) {
    return isDemoRefusal(cause);
  }
}

describe("demo site API reads", () => {
  test("every read the app makes parses with the app's schema", async () => {
    expect((await api.setup()).ownerExists).toBe(true);
    expect((await api.me()).email).toBe("owner@example.com");
    expect((await api.providers()).providers.map((entry) => entry.provider)).toEqual([
      ...providers,
    ]);
    expect((await api.connections()).connections).toEqual([]);
    const overview = await api.overview();
    expect(overview.connections).toEqual([]);
    expect(overview.providerOrder).toEqual([...providers]);
    expect((await api.settings()).settings).toEqual(defaultSettings);
    expect((await api.wallet()).topUps).toEqual([]);
    expect((await api.channels()).channels).toEqual([]);
    const rates = await api.exchangeRates();
    expect(rates.perUsd?.["USD"]).toBe(1);
    expect(Object.keys(rates.perUsd ?? {})).toHaveLength(10);
    expect((await api.refreshExchangeRates()).perUsd).toEqual(rates.perUsd);
  });

  test("the session is a signed-in synthetic owner", async () => {
    const body: unknown = await (await fetch("/api/auth/get-session")).json();
    expect(body).toMatchObject({ user: { email: "owner@example.com", username: "demo" } });
    expect(JSON.stringify(body)).not.toContain('null,"user"');
  });

  test("auth calls that need no answer succeed and sign-out does not break", async () => {
    expect((await fetch("/api/auth/passkey/list-user-passkeys")).status).toBe(200);
    expect((await fetch("/api/auth/sign-out", { method: "POST" })).status).toBe(200);
    expect((await fetch("/api/auth/sign-in/username", { method: "POST" })).status).toBe(409);
  });

  test("an unknown read is a 404", () => {
    expect(handleDemoRequest("GET", "/api/nothing", undefined).status).toBe(404);
  });
});

describe("demo site API writes", () => {
  test("settings are kept for the session", async () => {
    const saved = await api.saveSettings({ ...defaultSettings, lowThresholdPercent: 20 });
    expect(saved.settings.lowThresholdPercent).toBe(20);
    expect((await api.settings()).settings.lowThresholdPercent).toBe(20);
  });

  test("a settings document that does not parse is refused", () => {
    expect(handleDemoRequest("PUT", "/api/settings", { nope: 1 }).status).toBe(400);
  });

  test("every other change gets the demo refusal", async () => {
    expect(await refused(api.beginAttempt("codex", "cli_login"))).toBe(true);
    expect(await refused(api.rename("a", "b"))).toBe(true);
    expect(await refused(api.clearCost("a"))).toBe(true);
    expect(await refused(api.updateChannel("c", { enabled: true }))).toBe(true);
    expect(await refused(api.deleteChannel("c"))).toBe(true);
    expect(await refused(api.saveOrder({ providers: [], accounts: {} }))).toBe(true);
  });
});

describe("demo site fetch", () => {
  test("paths outside /api and other origins reach the original fetch", async () => {
    await fetch("/assets/app.js");
    await fetch("https://cdn.example.test/api/overview");
    await fetch(new URL("/favicon.ico", origin));
    expect(passed).toEqual([
      "/assets/app.js",
      "https://cdn.example.test/api/overview",
      `${origin}/favicon.ico`,
    ]);
  });

  test("an /api request never reaches the original fetch", async () => {
    await fetch("/api/overview");
    await fetch(`${origin}/api/wallet`, { method: "POST", body: "{}" });
    await fetch(new Request(`${origin}/api/settings`));
    expect(passed).toEqual([]);
  });
});

describe("embed messages", () => {
  test("accepts navigate and scheme from the landing page only", () => {
    const from = "headroom-site";
    expect(parseSiteMessage({ source: from, type: "navigate", page: "wallet" })).toEqual({
      source: from,
      type: "navigate",
      page: "wallet",
    });
    expect(parseSiteMessage({ source: from, type: "scheme", scheme: "dark" })?.type).toBe("scheme");
    expect(parseSiteMessage({ source: "other", type: "navigate", page: "wallet" })).toBeNull();
    expect(parseSiteMessage({ source: from, type: "navigate", page: "reconnect" })).toBeNull();
    expect(parseSiteMessage({ source: from, type: "scheme", scheme: "sepia" })).toBeNull();
    expect(parseSiteMessage("navigate")).toBeNull();
  });

  test("embed mode comes from the query string", () => {
    expect(isEmbedded("?embed=1")).toBe(true);
    expect(isEmbedded("")).toBe(false);
    expect(isEmbedded("?embed=0")).toBe(false);
  });
});
