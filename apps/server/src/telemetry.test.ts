import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { Fetch } from "./notify/http.ts";
import { loadOrCreateInstallId, posthogUrl, TelemetryService } from "./telemetry.ts";

const hour = 3_600_000;

function setup(options: { enabled?: boolean; key?: string; respond?: () => Response } = {}) {
  let now = 1_700_000_000_000;
  let enabled = options.enabled ?? true;
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const fetch: Fetch = (url, init) => {
    const body = typeof init.body === "string" ? init.body : "{}";
    sent.push({ url, body: z.record(z.string(), z.unknown()).parse(JSON.parse(body)) });
    return Promise.resolve(options.respond?.() ?? Response.json({ status: "Ok" }));
  };
  const service = new TelemetryService({
    fetch,
    now: () => new Date(now),
    enabled: () => enabled,
    installId: () => "install-1",
    facts: () => ({
      version: "0.2.0",
      platform: "linux",
      arch: "x64",
      install: "docker",
      accounts: { codex: 2, cursor: 1 },
    }),
    key: options.key ?? "phc_test",
  });
  return {
    service,
    sent,
    advance: (ms: number) => (now += ms),
    setEnabled: (value: boolean) => (enabled = value),
  };
}

describe("telemetry", () => {
  test("sends exactly the listed daily properties, anonymously", async () => {
    const h = setup();
    await h.service.tick();
    expect(h.sent).toEqual([
      {
        url: posthogUrl,
        body: {
          api_key: "phc_test",
          event: "install_active",
          distinct_id: "install-1",
          properties: {
            $process_person_profile: false,
            $geoip_disable: true,
            version: "0.2.0",
            os: "linux-x64",
            install: "docker",
            accounts: { codex: 2, cursor: 1 },
            account_total: 3,
          },
        },
      },
    ]);
  });

  test("sends the daily event once a day and opened only after a view", async () => {
    const h = setup();
    await h.service.tick();
    h.advance(hour);
    await h.service.tick();
    expect(h.sent.map((s) => s.body["event"])).toEqual(["install_active"]);

    h.service.markViewed("web");
    h.service.markViewed("mac");
    h.service.markViewed("web");
    h.advance(hour);
    await h.service.tick();
    expect(h.sent[1]?.body["event"]).toBe("opened");
    expect(h.sent[1]?.body["properties"]).toEqual({
      $process_person_profile: false,
      $geoip_disable: true,
      version: "0.2.0",
      surfaces: ["mac", "web"],
    });

    h.advance(23 * hour);
    await h.service.tick();
    expect(h.sent.map((s) => s.body["event"])).toEqual([
      "install_active",
      "opened",
      "install_active",
    ]);
  });

  test("sends nothing when turned off or without a project key", async () => {
    const off = setup({ enabled: false });
    off.service.markViewed("web");
    await off.service.tick();
    off.setEnabled(true);
    await off.service.tick();
    expect(off.sent.map((s) => s.body["event"])).toEqual(["install_active"]);

    const keyless = setup({ key: "" });
    keyless.service.markViewed("web");
    await keyless.service.tick();
    expect(keyless.sent).toEqual([]);
  });

  test("a failed send is dropped without throwing", async () => {
    const h = setup({ respond: () => new Response("no", { status: 500 }) });
    await h.service.tick();
    expect(h.sent).toHaveLength(1);
  });

  test("the install ID is created once and reused", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "headroom-telemetry-")), "data");
    const first = loadOrCreateInstallId(dir);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(loadOrCreateInstallId(dir)).toBe(first);
    expect(readFileSync(join(dir, "install-id"), "utf8").trim()).toBe(first);
  });
});
