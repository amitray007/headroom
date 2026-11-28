import { describe, expect, test } from "bun:test";

import { createApp } from "../app.ts";
import { activityFacts } from "../telemetry-facts.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

function harness() {
  const ctx = testContext();
  return { ctx, app: createApp(ctx) };
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
      },
    });
  });
});
