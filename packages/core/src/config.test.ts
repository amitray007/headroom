import { expect, test } from "bun:test";

import { baseUrl, loadConfig } from "./config.ts";

test("defaults suit local development", () => {
  const config = loadConfig({});
  expect(config).toEqual({
    dataDir: ".data",
    masterKeyFile: ".state/headroom.key",
    authSecretFile: ".state/headroom.auth-secret",
    port: 8080,
    trustedOrigins: [],
    logLevel: "info",
  });
  expect(baseUrl(config)).toBe("http://localhost:8080");
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
});
