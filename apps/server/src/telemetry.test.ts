import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import type { Fetch } from "./notify/http.ts";
import { loadOrCreateInstallId, macClientOf, posthogUrl, TelemetryService } from "./telemetry.ts";

const hour = 3_600_000;
const anonymous = { $process_person_profile: false, $geoip_disable: true };

const batchSchema = z.object({
  api_key: z.string(),
  batch: z.array(
    z.object({
      event: z.string(),
      distinct_id: z.string(),
      properties: z.record(z.string(), z.unknown()),
    }),
  ),
});

const event = (name: string, properties: Record<string, unknown>) => ({
  event: name,
  distinct_id: "install-1",
  properties: { ...properties, ...anonymous },
});
const connect = (provider: string, method: string, state: string) =>
  event("connect_result", { version: "0.2.0", provider, method, state });

/** Event names of every request, flattened. */
const names = (sent: readonly z.infer<typeof batchSchema>[]): string[] =>
  sent.flatMap((request) => request.batch.map((item) => item.event));

function setup(
  options: {
    enabled?: boolean;
    key?: string;
    respond?: () => Response;
    watermark?: number;
    installId?: () => string;
  } = {},
) {
  let now = 1_700_000_000_000;
  let enabled = options.enabled ?? true;
  let watermark: number | null = options.watermark ?? null;
  const since: number[] = [];
  const sent: z.infer<typeof batchSchema>[] = [];
  const urls: string[] = [];
  const fetch: Fetch = (url, init) => {
    const body = typeof init.body === "string" ? init.body : "{}";
    urls.push(url);
    sent.push(batchSchema.parse(JSON.parse(body)));
    return Promise.resolve(options.respond?.() ?? Response.json({ status: "Ok" }));
  };
  const service = new TelemetryService({
    version: "0.2.0",
    fetch,
    now: () => new Date(now),
    enabled: () => enabled,
    installId: options.installId ?? (() => "install-1"),
    watermark: { read: () => watermark, write: (at) => (watermark = at) },
    facts: (from) => {
      since.push(from);
      return {
        platform: "linux",
        arch: "x64",
        install: "docker",
        accounts: { codex: 2, cursor: 1 },
        connects: [
          { provider: "codex", method: "device_code", state: "succeeded", count: 1 },
          { provider: "cursor", method: "api_key", state: "failed", count: 2 },
        ],
        refreshes: [
          { provider: "codex", outcome: "succeeded", count: 90 },
          { provider: "cursor", outcome: "rate_limited", count: 2 },
          { provider: "cursor", outcome: "succeeded", count: 40 },
        ],
        features: { account_actions: false, auto_reset_rules: 1 },
      };
    },
    key: options.key ?? "phc_test",
  });
  return {
    service,
    sent,
    urls,
    since,
    now: () => now,
    advance: (ms: number) => (now += ms),
    setEnabled: (value: boolean) => (enabled = value),
  };
}

describe("telemetry", () => {
  test("sends exactly the listed daily events in one anonymous batch", async () => {
    const h = setup();
    await h.service.tick();
    expect(h.urls).toEqual([posthogUrl]);
    expect(h.sent).toEqual([
      {
        api_key: "phc_test",
        batch: [
          event("install_active", {
            version: "0.2.0",
            os: "linux-x64",
            install: "docker",
            account_total: 3,
            providers: ["codex", "cursor"],
            mac_clients: [],
            feature_account_actions: false,
            feature_auto_reset_rules: 1,
          }),
          event("provider_daily", {
            version: "0.2.0",
            provider: "codex",
            accounts: 2,
            refreshes: 90,
            refresh_failed: 0,
            refresh_succeeded: 90,
          }),
          event("provider_daily", {
            version: "0.2.0",
            provider: "cursor",
            accounts: 1,
            refreshes: 42,
            refresh_failed: 2,
            refresh_rate_limited: 2,
            refresh_succeeded: 40,
          }),
          connect("codex", "device_code", "succeeded"),
          connect("cursor", "api_key", "failed"),
          connect("cursor", "api_key", "failed"),
        ],
      },
    ]);
  });

  test("sends the daily events once a day and opened only after a view", async () => {
    const h = setup();
    await h.service.tick();
    h.advance(hour);
    await h.service.tick();
    expect(h.sent).toHaveLength(1);

    h.service.markViewed("web");
    h.service.markViewed("mac");
    h.service.markViewed("web");
    h.service.markView("wallet");
    h.service.markView("analytics");
    h.advance(hour);
    await h.service.tick();
    expect(h.sent[1]?.batch).toEqual([
      {
        event: "opened",
        distinct_id: "install-1",
        properties: {
          version: "0.2.0",
          surfaces: ["mac", "web"],
          views: ["analytics", "wallet"],
          ...anonymous,
        },
      },
    ]);

    h.advance(23 * hour);
    await h.service.tick();
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2]?.batch[0]?.event).toBe("install_active");
  });

  test("sends nothing when turned off or without a project key", async () => {
    const off = setup({ enabled: false });
    off.service.markViewed("web");
    await off.service.tick();
    off.setEnabled(true);
    await off.service.tick();
    expect(names(off.sent)).not.toContain("opened");
    expect(names(off.sent)[0]).toBe("install_active");

    const keyless = setup({ key: "" });
    keyless.service.markViewed("web");
    await keyless.service.tick();
    expect(keyless.sent).toEqual([]);
  });

  test("reports Mac app and widget versions from the user agent, and nothing else", async () => {
    expect(macClientOf("Headroom/1.2.0 CFNetwork/1568 Darwin/25.0.0")).toBe("Headroom/1.2.0");
    expect(macClientOf("HeadroomWidgets/1.2.0")).toBe("HeadroomWidgets/1.2.0");
    expect(macClientOf("curl/8.0")).toBeNull();
    expect(macClientOf(undefined)).toBeNull();
    const h = setup();
    h.service.markClient("Headroom/1.2.0 CFNetwork/1568 Darwin/25.0.0");
    h.service.markClient("Mozilla/5.0");
    await h.service.tick();
    expect(h.sent[0]?.batch[0]?.properties).toMatchObject({ mac_clients: ["Headroom/1.2.0"] });
  });

  test("feedback is sent as typed with the version, linked to the install only while stats are on", async () => {
    const on = setup();
    expect(await on.service.sendFeedback("Love the Wallet")).toBe("sent");
    expect(on.sent[0]?.batch).toEqual([
      {
        event: "feedback",
        distinct_id: "install-1",
        properties: { version: "0.2.0", message: "Love the Wallet", ...anonymous },
      },
    ]);

    const off = setup({ enabled: false });
    expect(await off.service.sendFeedback("Love the Wallet")).toBe("sent");
    const id = off.sent[0]?.batch[0]?.distinct_id;
    expect(id).not.toBe("install-1");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    expect(await setup({ key: "" }).service.sendFeedback("hi")).toBe("unavailable");
    const failing = setup({ respond: () => new Response("no", { status: 500 }) });
    expect(await failing.service.sendFeedback("hi")).toBe("failed");
    const noId = setup({
      installId: () => {
        throw new Error("read-only data directory");
      },
    });
    expect(await noId.service.sendFeedback("hi")).toBe("failed");
  });

  test("feedback waits 30 seconds between messages", async () => {
    const h = setup();
    expect(await h.service.sendFeedback("one")).toBe("sent");
    expect(await h.service.sendFeedback("two")).toBe("too_soon");
    h.advance(30_000);
    expect(await h.service.sendFeedback("three")).toBe("sent");
    expect(h.sent).toHaveLength(2);
  });

  test("activity is reported once: never again after a restart, never for a period with stats off", async () => {
    const day = 24 * hour;
    const first = setup({ watermark: 1_700_000_000_000 - 3 * hour });
    await first.service.tick();
    expect(first.since).toEqual([1_700_000_000_000 - 3 * hour]);

    const off = setup({ enabled: false });
    await off.service.tick();
    off.advance(5 * hour);
    off.setEnabled(true);
    await off.service.tick();
    expect(off.since).toEqual([1_700_000_000_000 + 5 * hour]);

    const longGone = setup({ watermark: 1_700_000_000_000 - 9 * day });
    await longGone.service.tick();
    expect(longGone.since).toEqual([1_700_000_000_000 - day]);
  });

  test("sign-ins beyond the daily cap are not sent one by one", async () => {
    const h = setup();
    const many = new TelemetryService({
      version: "0.2.0",
      fetch: (url, init) => {
        h.sent.push(
          batchSchema.parse(JSON.parse(typeof init.body === "string" ? init.body : "{}")),
        );
        return Promise.resolve(Response.json({ status: "Ok" }));
      },
      now: () => new Date(h.now()),
      enabled: () => true,
      installId: () => "install-1",
      watermark: { read: () => null, write: () => undefined },
      facts: () => ({
        platform: "linux",
        arch: "x64",
        install: "docker",
        accounts: {},
        connects: [{ provider: "codex", method: "cli_login", state: "failed", count: 100_000 }],
        refreshes: [],
        features: {},
      }),
      key: "phc_test",
    });
    await many.tick();
    expect(names(h.sent).filter((name) => name === "connect_result")).toHaveLength(50);
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
