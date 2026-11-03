import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

const startedSchema = z.object({
  code: z.string(),
  deviceCode: z.string(),
  expiresIn: z.literal(600),
  interval: z.literal(2),
});
const tokenAnswer = z.object({ status: z.string(), token: z.string().optional() });

function fixture(now: () => Date = () => new Date()) {
  const ctx = testContext({}, { now });
  const app = createApp(ctx);
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(url(ctx, path), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const start = async (name = "Studio Mac") => {
    const response = await post("/api/app/v1/pair", { name });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return startedSchema.parse(await response.json());
  };
  const poll = async (deviceCode: string) => {
    const response = await post("/api/app/v1/pair/token", { deviceCode });
    return { status: response.status, body: await response.json() };
  };
  return { ctx, app, post, start, poll };
}

describe("device pairing", () => {
  test("start, poll pending, approve in the dashboard, receive a read-only token once", async () => {
    const { ctx, app, start, poll } = fixture();
    const cookie = await signedIn(ctx, app);
    const started = await start();
    expect(started.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(await poll(started.deviceCode)).toEqual({ status: 200, body: { status: "pending" } });

    const lookup = await app.request(url(ctx, `/api/pairings/${started.code.toLowerCase()}`), {
      headers: { cookie },
    });
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toMatchObject({ name: "Studio Mac", status: "pending" });

    const approve = await app.request(
      url(ctx, `/api/pairings/${started.code.replace("-", "")}/approve`),
      jsonPost(ctx, {}, { cookie }),
    );
    expect(approve.status).toBe(200);

    const approved = await poll(started.deviceCode);
    expect(approved.status).toBe(200);
    const answer = tokenAnswer.parse(approved.body);
    expect(answer.status).toBe("approved");
    expect(answer.token).toBeString();
    expect(await poll(started.deviceCode)).toEqual({ status: 404, body: { error: "not_found" } });

    const headers = { authorization: `Bearer ${answer.token}` };
    expect((await app.request(url(ctx, "/api/app/v1/feed"), { headers })).status).toBe(200);
    const whoami = await app.request(url(ctx, "/api/app/v1/whoami"), { headers });
    expect(await whoami.json()).toMatchObject({ tokenName: "Studio Mac", scopes: ["read"] });
    const refresh = await app.request(url(ctx, "/api/app/v1/settings/refresh"), {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ refreshIntervalMinutes: 30 }),
    });
    expect(refresh.status).toBe(403);
    ctx.sqlite.close();
  });

  test("a denial is reported once, then the device code is unknown", async () => {
    const { ctx, app, start, poll } = fixture();
    const cookie = await signedIn(ctx, app);
    const started = await start();
    const deny = await app.request(
      url(ctx, `/api/pairings/${started.code}/deny`),
      jsonPost(ctx, {}, { cookie }),
    );
    expect(deny.status).toBe(200);
    expect(await poll(started.deviceCode)).toEqual({ status: 200, body: { status: "denied" } });
    expect((await poll(started.deviceCode)).status).toBe(404);
    ctx.sqlite.close();
  });

  test("the dashboard still sees the decision after the app has heard it", async () => {
    const { ctx, app, start, poll } = fixture();
    const cookie = await signedIn(ctx, app);
    const started = await start();
    await app.request(
      url(ctx, `/api/pairings/${started.code}/approve`),
      jsonPost(ctx, {}, { cookie }),
    );
    expect((await poll(started.deviceCode)).body).toMatchObject({ status: "approved" });
    const lookup = await app.request(url(ctx, `/api/pairings/${started.code}`), {
      headers: { cookie },
    });
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toMatchObject({ status: "approved" });
    ctx.sqlite.close();
  });

  test("a decided pairing cannot be decided again", async () => {
    const { ctx, app, start } = fixture();
    const cookie = await signedIn(ctx, app);
    const started = await start();
    const decide = (action: string) =>
      app.request(
        url(ctx, `/api/pairings/${started.code}/${action}`),
        jsonPost(ctx, {}, { cookie }),
      );
    expect((await decide("approve")).status).toBe(200);
    const again = await decide("deny");
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "not_pending" });
    ctx.sqlite.close();
  });

  test("an expired pairing answers expired once and the dashboard sees 404", async () => {
    let at = Date.UTC(2026, 10, 2);
    const { ctx, app, start, poll } = fixture(() => new Date(at));
    const cookie = await signedIn(ctx, app);
    const started = await start();
    at += 600_000;
    const lookup = await app.request(url(ctx, `/api/pairings/${started.code}`), {
      headers: { cookie },
    });
    expect(lookup.status).toBe(404);
    const approve = await app.request(
      url(ctx, `/api/pairings/${started.code}/approve`),
      jsonPost(ctx, {}, { cookie }),
    );
    expect(approve.status).toBe(404);
    expect(await poll(started.deviceCode)).toEqual({ status: 200, body: { status: "expired" } });
    expect((await poll(started.deviceCode)).status).toBe(404);
    ctx.sqlite.close();
  });

  test("unknown codes and device codes answer 404; bad bodies answer 400", async () => {
    const { ctx, app, post, poll } = fixture();
    const cookie = await signedIn(ctx, app);
    const lookups = await Promise.all(
      ["ABC-234", "nonsense"].map(async (code) =>
        app.request(url(ctx, `/api/pairings/${code}`), { headers: { cookie } }),
      ),
    );
    expect(lookups.map((response) => response.status)).toEqual([404, 404]);
    expect((await poll("never-issued")).status).toBe(404);
    const bad = await Promise.all(
      [{}, { name: "" }, { name: "x".repeat(41) }, { name: "ok", extra: 1 }].map((body) =>
        post("/api/app/v1/pair", body),
      ),
    );
    expect(bad.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect(await bad[0]?.json()).toEqual({ error: "invalid_body" });
    expect((await post("/api/app/v1/pair/token", {})).status).toBe(400);
    ctx.sqlite.close();
  });

  test("an address may start ten pairings in ten minutes, then gets 429 with Retry-After", async () => {
    const { ctx, post } = fixture();
    const allowed = await Promise.all(
      Array.from({ length: 10 }, () => post("/api/app/v1/pair", { name: "Mac" })),
    );
    expect(allowed.map((response) => response.status)).toEqual(Array(10).fill(200));
    const refused = await post("/api/app/v1/pair", { name: "Mac" });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "rate_limited" });
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    ctx.sqlite.close();
  });

  test("one hundred live pairings is the ceiling across addresses", async () => {
    const { ctx, post } = fixture();
    // The test app has no socket, so every request shares one address. Fill the ceiling through the service.
    for (let i = 0; i < 100; i++) expect(ctx.pairings.start("Mac", `client-${i}`).ok).toBe(true);
    const refused = await post("/api/app/v1/pair", { name: "Mac" });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).not.toBeNull();
    ctx.sqlite.close();
  });

  test("the dashboard routes need a session", async () => {
    const { ctx, app, start } = fixture();
    const started = await start();
    const code = started.code;
    const responses = await Promise.all(
      (
        [
          ["GET", `/api/pairings/${code}`],
          ["POST", `/api/pairings/${code}/approve`],
          ["POST", `/api/pairings/${code}/deny`],
        ] as const
      ).map(async ([method, path]) =>
        app.request(url(ctx, path), method === "POST" ? jsonPost(ctx, {}) : { method }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(ctx.pairings.find(code)?.status).toBe("pending");
    ctx.sqlite.close();
  });

  test("a cross-site approval is refused", async () => {
    const { ctx, app, start } = fixture();
    const cookie = await signedIn(ctx, app);
    const started = await start();
    const response = await app.request(
      url(ctx, `/api/pairings/${started.code}/approve`),
      jsonPost(ctx, {}, { cookie, "sec-fetch-site": "cross-site" }),
    );
    expect(response.status).toBe(403);
    expect(ctx.pairings.find(started.code)?.status).toBe("pending");
    ctx.sqlite.close();
  });
});
