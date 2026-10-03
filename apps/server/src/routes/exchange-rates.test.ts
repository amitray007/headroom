import { describe, expect, test } from "bun:test";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

const rates = {
  base: "USD",
  date: "2026-10-02",
  rates: {
    AUD: 1.4411,
    BRL: 5.2214,
    CAD: 1.424,
    CHF: 0.82664,
    EUR: 0.89087,
    GBP: 0.75753,
    INR: 96.32,
    JPY: 157.67,
    SGD: 1.2798,
  },
};

const now = 1_700_000_000_000;

function harness(fail = false) {
  let calls = 0;
  const ctx = testContext(
    {},
    {
      now: () => new Date(now),
      fetch: () => {
        calls += 1;
        return Promise.resolve(fail ? new Response("x", { status: 500 }) : Response.json(rates));
      },
    },
  );
  return { ctx, app: createApp(ctx), calls: () => calls };
}

describe("exchange rate routes", () => {
  test("both routes need a signed-in owner", async () => {
    const h = harness();
    const get = await h.app.request(url(h.ctx, "/api/exchange-rates"));
    expect(get.status).toBe(401);
    const post = await h.app.request(
      url(h.ctx, "/api/exchange-rates/refresh"),
      jsonPost(h.ctx, {}),
    );
    expect(post.status).toBe(401);
    expect(h.calls()).toBe(0);
  });

  test("GET fetches on first read and serves the cache after", async () => {
    const h = harness();
    const cookie = await signedIn(h.ctx, h.app);
    const first = await h.app.request(url(h.ctx, "/api/exchange-rates"), { headers: { cookie } });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      base: "USD",
      date: "2026-10-02",
      fetchedAt: now,
      perUsd: { USD: 1, ...rates.rates },
      error: null,
    });
    await h.app.request(url(h.ctx, "/api/exchange-rates"), { headers: { cookie } });
    expect(h.calls()).toBe(1);
  });

  test("POST refresh returns the same shape, and a second press inside 60 seconds does not fetch", async () => {
    const h = harness();
    const cookie = await signedIn(h.ctx, h.app);
    const send = () =>
      h.app.request(url(h.ctx, "/api/exchange-rates/refresh"), jsonPost(h.ctx, {}, { cookie }));
    const first = await send();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ perUsd: { INR: 96.32 } });
    await send();
    expect(h.calls()).toBe(1);
  });

  test("a failed fetch answers 200 with null rates and the error", async () => {
    const h = harness(true);
    const cookie = await signedIn(h.ctx, h.app);
    const response = await h.app.request(url(h.ctx, "/api/exchange-rates"), {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      base: "USD",
      date: null,
      fetchedAt: null,
      perUsd: null,
      error: "The rate service answered with status 500.",
    });
  });

  test("a cross-site POST is refused", async () => {
    const h = harness();
    const cookie = await signedIn(h.ctx, h.app);
    const response = await h.app.request(
      url(h.ctx, "/api/exchange-rates/refresh"),
      jsonPost(h.ctx, {}, { cookie, origin: "https://evil.example" }),
    );
    expect(response.status).toBe(403);
    expect(h.calls()).toBe(0);
  });
});
