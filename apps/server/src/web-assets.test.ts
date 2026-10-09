import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createApp } from "./app.ts";
import { testContext, url } from "./test-helpers.ts";
import { defaultWebDir, resolveWebAssets, webUnavailableMessage } from "./web-assets.ts";

async function withFiles(files: Record<string, string>, run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "headroom-assets-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const site = {
  "index.html": "<!doctype html><title>shell</title>",
  "favicon.svg": "<svg/>",
  "assets/app-abc123.js": "console.log(1)",
  "assets/app-abc123.css": "body{}",
};

describe("resolveWebAssets", () => {
  test("maps URL paths to files with content type and cache headers", () =>
    withFiles(site, async (dir) => {
      const web = resolveWebAssets(dir, null);
      const js = web?.file("/assets/app-abc123.js");
      expect(js?.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
      expect(js?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(await js?.text()).toBe("console.log(1)");
      expect(web?.file("/assets/app-abc123.css")?.headers.get("content-type")).toContain(
        "text/css",
      );
      expect(web?.file("/favicon.svg")?.headers.get("content-type")).toBe("image/svg+xml");
      const index = web?.index();
      expect(index?.headers.get("cache-control")).toBe("no-cache");
      expect(index?.headers.get("content-type")).toContain("text/html");
    }));

  test("unknown, traversing and undecodable paths are not files", () =>
    withFiles(site, async (dir) => {
      const web = resolveWebAssets(dir, null);
      expect(web?.file("/connect")).toBeNull();
      expect(web?.file("/assets/missing.js")).toBeNull();
      expect(web?.file("/assets/../index.html")).toBeNull();
      expect(web?.file("/assets/%2e%2e/index.html")).toBeNull();
      expect(web?.file("/assets/%E0%A4%A")).toBeNull();
    }));

  test("embedded assets serve when no directory was chosen", () =>
    withFiles(site, async (dir) => {
      const embedded = new Map(Object.keys(site).map((name) => [name, join(dir, name)]));
      const web = resolveWebAssets(defaultWebDir, embedded);
      expect(web?.kind).toBe("embedded");
      expect(await web?.file("/assets/app-abc123.js")?.text()).toBe("console.log(1)");
      expect(await web?.index().text()).toContain("shell");
    }));

  test("an explicit directory beats embedded assets; a missing one falls back to them", () =>
    withFiles(site, async (dir) => {
      const embedded = new Map([["index.html", join(dir, "index.html")]]);
      expect(resolveWebAssets(dir, embedded)?.kind).toBe("disk");
      expect(resolveWebAssets(join(dir, "nope"), embedded)?.kind).toBe("embedded");
    }));

  test("nothing available resolves to null", () => {
    expect(resolveWebAssets(join(tmpdir(), "headroom-no-such-dir"), null)).toBeNull();
    expect(webUnavailableMessage("x")).toContain("not available");
  });
});

describe("web UI in the app", () => {
  test("warns once at startup when no UI is available and keeps the API", async () => {
    const ctx = testContext({ HEADROOM_WEB_DIR: join(tmpdir(), "headroom-no-such-dir") });
    const logs: string[] = [];
    const app = createApp({ ...ctx, log: (level, message) => logs.push(`${level} ${message}`) });
    expect(logs.filter((line) => line.startsWith("warn web UI not available"))).toHaveLength(1);
    expect((await app.request(url(ctx, "/healthz"))).status).toBe(200);
    expect((await app.request(url(ctx, "/connect"))).status).toBe(404);
  });

  test("serves hashed assets with long cache and falls back to the shell", () =>
    withFiles(site, async (dir) => {
      const ctx = testContext({ HEADROOM_WEB_DIR: dir });
      const app = createApp(ctx);
      const asset = await app.request(url(ctx, "/assets/app-abc123.js"));
      expect(asset.headers.get("cache-control")).toContain("immutable");
      expect(asset.headers.get("content-security-policy")).toContain("default-src 'self'");
      const route = await app.request(url(ctx, "/connect"));
      expect(await route.text()).toContain("shell");
      expect((await app.request(url(ctx, "/api/me"))).status).toBe(401);
    }));
});
