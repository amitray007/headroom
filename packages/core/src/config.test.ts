import { expect, test } from "bun:test";

import { baseUrl, loadConfig } from "./config.ts";

const mac = { platform: "darwin", home: "/Users/amy" };
const linux = { platform: "linux", home: "/home/amy" };

test("defaults on macOS live under Application Support", () => {
  const config = loadConfig({}, mac);
  expect(config).toEqual({
    dataDir: "/Users/amy/Library/Application Support/Headroom/data",
    masterKeyFile: "/Users/amy/Library/Application Support/Headroom/headroom.key",
    authSecretFile: "/Users/amy/Library/Application Support/Headroom/headroom.auth-secret",
    port: 8080,
    host: "127.0.0.1",
    trustedOrigins: [],
    logLevel: "info",
    trustProxy: false,
    webDir: "apps/web/dist",
    enabledProviders: [
      "codex",
      "claude",
      "grok",
      "antigravity",
      "copilot",
      "cursor",
      "vercel_ai_gateway",
    ],
    refreshIntervalSeconds: 900,
    staleAfterSeconds: 43_200,
  });
  expect(baseUrl(config)).toBe("http://localhost:8080");
});

test("defaults on Linux follow XDG and keep the key out of the data directory", () => {
  const plain = loadConfig({}, linux);
  expect(plain.dataDir).toBe("/home/amy/.local/share/headroom/data");
  expect(plain.masterKeyFile).toBe("/home/amy/.config/headroom/headroom.key");
  expect(plain.authSecretFile).toBe("/home/amy/.config/headroom/headroom.auth-secret");
  const xdg = loadConfig({ XDG_DATA_HOME: "/x/data", XDG_CONFIG_HOME: "/x/conf" }, linux);
  expect(xdg.dataDir).toBe("/x/data/headroom/data");
  expect(xdg.masterKeyFile).toBe("/x/conf/headroom/headroom.key");
});

test("host, sign-in binaries and path overrides come from the environment", () => {
  const config = loadConfig(
    {
      HEADROOM_HOST: "0.0.0.0",
      HEADROOM_CODEX_BIN: "/opt/codex",
      HEADROOM_CLAUDE_BIN: "/opt/claude",
      HEADROOM_GROK_BIN: "/opt/grok",
      HEADROOM_DATA_DIR: ".data",
    },
    mac,
  );
  expect(config.host).toBe("0.0.0.0");
  expect(config.codexBin).toBe("/opt/codex");
  expect(config.claudeBin).toBe("/opt/claude");
  expect(config.grokBin).toBe("/opt/grok");
  expect(config.dataDir).toBe(".data");
  expect(loadConfig({}, mac).codexBin).toBeUndefined();
});

test("environment overrides, coerces and normalizes origins", () => {
  const config = loadConfig({
    HEADROOM_DATA_DIR: "/var/lib/headroom",
    HEADROOM_MASTER_KEY_FILE: "/etc/headroom/key",
    HEADROOM_AUTH_SECRET_FILE: "/etc/headroom/auth",
    HEADROOM_PORT: "9090",
    HEADROOM_PUBLIC_URL: "https://headroom.example.com/",
    HEADROOM_TRUSTED_ORIGINS: " https://app.example.com , http://localhost:5173 ",
    HEADROOM_LOG_LEVEL: "debug",
  });
  expect(config.port).toBe(9090);
  expect(config.publicUrl).toBe("https://headroom.example.com");
  expect(config.trustedOrigins).toEqual(["https://app.example.com", "http://localhost:5173"]);
  expect(baseUrl(config)).toBe("https://headroom.example.com");
});

test("empty strings fall back to defaults and bad values fail loudly", () => {
  expect(loadConfig({ HEADROOM_PORT: "" }).port).toBe(8080);
  expect(() => loadConfig({ HEADROOM_PORT: "70000" })).toThrow();
  expect(() => loadConfig({ HEADROOM_PUBLIC_URL: "not a url" })).toThrow();
  expect(() => loadConfig({ HEADROOM_PUBLIC_URL: "https://example.com/dashboard" })).toThrow();
  expect(() => loadConfig({ HEADROOM_TRUSTED_ORIGINS: "https://ok.example, nope" })).toThrow();
  expect(() => loadConfig({ HEADROOM_ENABLED_PROVIDERS: "codex,fireworks" })).toThrow();
  expect(loadConfig({ HEADROOM_ENABLED_PROVIDERS: " claude , codex" }).enabledProviders).toEqual([
    "claude",
    "codex",
  ]);
  expect(() => loadConfig({ HEADROOM_REFRESH_INTERVAL_SECONDS: "5" })).toThrow();
  expect(loadConfig({ HEADROOM_TRUST_PROXY: "true" }).trustProxy).toBe(true);
  expect(() => loadConfig({ HEADROOM_TRUST_PROXY: "yes" })).toThrow();
});
