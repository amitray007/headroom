import { expect, test } from "bun:test";

import { loadConfig } from "./config.ts";

test("defaults suit local development", () => {
  const config = loadConfig({});
  expect(config).toEqual({
    dataDir: ".data",
    masterKeyFile: ".state/headroom.key",
    port: 8080,
    logLevel: "info",
  });
});

test("environment overrides and coerces", () => {
  const config = loadConfig({
    HEADROOM_DATA_DIR: "/var/lib/headroom",
    HEADROOM_MASTER_KEY_FILE: "/etc/headroom/key",
    HEADROOM_PORT: "9090",
    HEADROOM_PUBLIC_URL: "https://headroom.example.com",
    HEADROOM_LOG_LEVEL: "debug",
  });
  expect(config.port).toBe(9090);
  expect(config.publicUrl).toBe("https://headroom.example.com");
  expect(config.logLevel).toBe("debug");
});

test("empty strings fall back to defaults and bad values fail loudly", () => {
  expect(loadConfig({ HEADROOM_PORT: "" }).port).toBe(8080);
  expect(() => loadConfig({ HEADROOM_PORT: "70000" })).toThrow();
  expect(() => loadConfig({ HEADROOM_PUBLIC_URL: "not a url" })).toThrow();
});
