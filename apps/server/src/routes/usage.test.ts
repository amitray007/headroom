import { describe, expect, test } from "bun:test";

import { createApp } from "../app.ts";
import { activityFacts } from "../telemetry-facts.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

function harness() {
  const ctx = testContext();
  return { ctx, app: createApp(ctx) };
}

/** A context with a project key and a recording fake for PostHog and GitHub. */
function keyed(posthog: () => Response = () => Response.json({ status: "Ok" })) {
  const urls: string[] = [];
  const ctx = testContext(
    {},
    {
      telemetryKey: "phc_test",
      fetch: (input) => {
        urls.push(input);
        if (new URL(input).host === "api.github.com") {
          return Promise.resolve(Response.json({ tag_name: "v99.0.0" }));
        }
        return Promise.resolve(posthog());
      },
    },
  );
  return { ctx, app: createApp(ctx), urls };
}

describe("usage routes", () => {
  test("need a signed-in owner", async () => {
    const h = harness();
    const view = await h.app.request(
      url(h.ctx, "/api/usage/view"),
      jsonPost(h.ctx, { view: "wallet" }),
    );
    const feedback = await h.app.request(
      url(h.ctx, "/api/feedback"),
      jsonPost(h.ctx, { message: "hi" }),
    );
    expect([view.status, feedback.status]).toEqual([401, 401]);
  });

  test("an action is accepted only from the known list", async () => {
    const h = harness();
    const cookie = await signedIn(h.ctx, h.app);
    const post = (action: string) =>
      h.app.request(url(h.ctx, "/api/usage/action"), jsonPost(h.ctx, { action }, { cookie }));
    expect([(await post("update_opened")).status, (await post("other")).status]).toEqual([
      204, 400,
    ]);
  });

  test("a web error keeps only its class and cleaned frames", async () => {
    const h = harness();
    const cookie = await signedIn(h.ctx, h.app);
    const post = (body: unknown) =>
      h.app.request(url(h.ctx, "/api/usage/error"), jsonPost(h.ctx, body, { cookie }));
    const ok = await post({
      type: "TypeError",
      where: "render",
      stack: "TypeError: x\n    at render (https://my.host.ts.net/assets/index-a1.js:1:2)",
    });
    expect(ok.status).toBe(204);
    expect((await post({ type: "TypeError", where: "elsewhere", stack: "" })).status).toBe(400);
  });

  test("a view is accepted only from the known list", async () => {
    const h = harness();
    const cookie = await signedIn(h.ctx, h.app);
    const ok = await h.app.request(
      url(h.ctx, "/api/usage/view"),
      jsonPost(h.ctx, { view: "wallet" }, { cookie }),
    );
    const bad = await h.app.request(
      url(h.ctx, "/api/usage/view"),
      jsonPost(h.ctx, { view: "secret" }, { cookie }),
    );
    expect([ok.status, bad.status]).toEqual([204, 400]);
  });

  test("feedback checks its length and says when no project key is set", async () => {
    const h = harness();
    const cookie = await signedIn(h.ctx, h.app);
    const post = (message: string) =>
      h.app.request(url(h.ctx, "/api/feedback"), jsonPost(h.ctx, { message }, { cookie }));
    expect((await post("   ")).status).toBe(400);
    expect((await post("x".repeat(2001))).status).toBe(400);
    const none = await post("Love it");
    expect(none.status).toBe(503);
    expect(await none.json()).toEqual({ error: "feedback_unavailable" });
  });
});

describe("feedback with a project key", () => {
  test("sends once, then asks the owner to wait", async () => {
    const h = keyed();
    const cookie = await signedIn(h.ctx, h.app);
    const post = () =>
      h.app.request(
        url(h.ctx, "/api/feedback"),
        jsonPost(h.ctx, { message: "Love it" }, { cookie }),
      );
    expect((await post()).status).toBe(204);
    const again = await post();
    expect(again.status).toBe(429);
    expect(await again.json()).toEqual({ error: "feedback_too_soon" });
    expect(h.urls).toHaveLength(1);
  });

  test("a PostHog failure answers 503 feedback_failed", async () => {
    const h = keyed(() => new Response("no", { status: 500 }));
    const cookie = await signedIn(h.ctx, h.app);
    const response = await h.app.request(
      url(h.ctx, "/api/feedback"),
      jsonPost(h.ctx, { message: "Love it" }, { cookie }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "feedback_failed" });
  });
});

describe("version route", () => {
  test("needs a session and offers a newer release with its notes", async () => {
    const h = keyed();
    expect((await h.app.request(url(h.ctx, "/api/version"))).status).toBe(401);
    const cookie = await signedIn(h.ctx, h.app);
    const response = await h.app.request(url(h.ctx, "/api/version"), { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ update: { version: "99.0.0" } });
  });
});

describe("activity facts", () => {
  test("count finished sign-ins by provider, method and state, and read feature use", () => {
    const { ctx } = harness();
    const insert = ctx.sqlite.query(
      "INSERT INTO auth_attempts (id, provider, method, state, expires_at, created_at, updated_at) VALUES (?, 'codex', 'device_code', ?, 0, 0, ?)",
    );
    insert.run("a", "succeeded", 2_000);
    insert.run("b", "failed", 2_000);
    insert.run("c", "awaiting_user", 2_000);
    insert.run("d", "succeeded", 500);
    expect(activityFacts(ctx.sqlite, ctx.settings.get(), 1_000)).toEqual({
      connects: [
        { provider: "codex", method: "device_code", state: "failed", count: 1 },
        { provider: "codex", method: "device_code", state: "succeeded", count: 1 },
      ],
      refreshes: [],
      actions: [],
      deliveries: [],
      metrics: [],
      features: {
        account_actions: false,
        auto_reset_rules: 0,
        spend_budgets: 0,
        wallet_costs: 0,
        wallet_top_ups: 0,
        channels_telegram: 0,
        channels_webhook: 0,
        refresh_minutes: 15,
        history_days: 90,
        limits_view: "used",
        low_threshold_percent: 30,
        time_style: "countdown",
        clock: "24h",
        density: "comfortable",
        detailed_order: "urgency",
        keep_inactive_last: true,
        wallet_currency: "auto",
        notification_kinds_on: expect.any(Number),
        notification_sessions: true,
        notification_lead_days: 3,
        muted_providers: 0,
      },
    });
  });
});
