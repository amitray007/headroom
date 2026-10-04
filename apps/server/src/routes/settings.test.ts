import { describe, expect, test } from "bun:test";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

async function harness() {
  const ctx = testContext();
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const put = (body: unknown) =>
    app.request(url(ctx, "/api/settings"), { ...jsonPost(ctx, body, { cookie }), method: "PUT" });
  return { ctx, app, cookie, put };
}

describe("settings history retention", () => {
  test("defaults to 90 days and accepts each allowed value", async () => {
    const h = await harness();
    expect(h.ctx.settings.get().historyRetentionDays).toBe(90);
    for (const days of [30, 180, 365, 90] as const) {
      // eslint-disable-next-line no-await-in-loop -- each save must land before the next one
      const response = await h.put({ ...h.ctx.settings.get(), historyRetentionDays: days });
      expect(response.status).toBe(200);
      expect(h.ctx.settings.get().historyRetentionDays).toBe(days);
    }
  });

  test("rejects other values and a missing field", async () => {
    const h = await harness();
    const full = h.ctx.settings.get();
    const { historyRetentionDays: _drop, ...without } = full;
    const bodies = [
      { ...full, historyRetentionDays: 45 },
      { ...full, historyRetentionDays: 0 },
      { ...full, historyRetentionDays: "90" },
      without,
    ];
    const responses = await Promise.all(bodies.map(async (body) => h.put(body)));
    expect(responses.map((r) => r.status)).toEqual([400, 400, 400, 400]);
    expect(h.ctx.settings.get()).toEqual(full);
  });
});
