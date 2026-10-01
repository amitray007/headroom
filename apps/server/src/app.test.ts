import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createApp } from "./app.ts";
import { cookieFrom, testContext } from "./test-helpers.ts";

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
  body: JSON.stringify(body),
});

describe("health and setup", () => {
  test("healthz is public", async () => {
    const app = createApp(testContext());
    const response = await app.request("/healthz");
    expect(response.status).toBe(200);
    expect(z.object({ status: z.literal("ok") }).parse(await response.json()).status).toBe("ok");
  });

  test("setup creates the owner once and signs in", async () => {
    const app = createApp(testContext());
    const before = await app.request("/api/auth/setup");
    expect(z.object({ ownerExists: z.boolean() }).parse(await before.json()).ownerExists).toBe(
      false,
    );

    const weak = await app.request("/api/auth/setup", json({ password: "short" }));
    expect(weak.status).toBe(400);

    const created = await app.request(
      "/api/auth/setup",
      json({ password: "correct horse battery" }),
    );
    expect(created.status).toBe(201);
    const cookie = cookieFrom(created);
    expect(cookie.startsWith("headroom_session=")).toBe(true);
    expect(created.headers.get("set-cookie")).toContain("HttpOnly");

    const again = await app.request("/api/auth/setup", json({ password: "another long password" }));
    expect(again.status).toBe(409);

    const me = await app.request("/api/auth/me", { headers: { cookie } });
    expect(me.status).toBe(200);
  });
});

async function appWithOwner() {
  const app = createApp(testContext());
  await app.request("/api/auth/setup", json({ password: "correct horse battery" }));
  return app;
}

describe("sessions", () => {
  test("login, me, logout", async () => {
    const app = await appWithOwner();
    expect((await app.request("/api/auth/me")).status).toBe(401);
    const bad = await app.request("/api/auth/session", json({ password: "wrong password here" }));
    expect(bad.status).toBe(401);
    const ok = await app.request("/api/auth/session", json({ password: "correct horse battery" }));
    expect(ok.status).toBe(200);
    const cookie = cookieFrom(ok);
    expect((await app.request("/api/auth/me", { headers: { cookie } })).status).toBe(200);
    const out = await app.request("/api/auth/session", {
      method: "DELETE",
      headers: { cookie, "sec-fetch-site": "same-origin" },
    });
    expect(out.status).toBe(200);
    expect((await app.request("/api/auth/me", { headers: { cookie } })).status).toBe(401);
  });

  test("password change invalidates the session", async () => {
    const app = await appWithOwner();
    const cookie = cookieFrom(
      await app.request("/api/auth/session", json({ password: "correct horse battery" })),
    );
    const changed = await app.request(
      "/api/auth/password",
      json({ current: "correct horse battery", next: "a brand new long password" }, { cookie }),
    );
    expect(changed.status).toBe(200);
    expect((await app.request("/api/auth/me", { headers: { cookie } })).status).toBe(401);
    const relogin = await app.request(
      "/api/auth/session",
      json({ password: "a brand new long password" }),
    );
    expect(relogin.status).toBe(200);
  });

  test("cross-site mutations are rejected, same-origin and non-browser allowed", async () => {
    const app = await appWithOwner();
    const crossSite = await app.request("/api/auth/session", {
      ...json({ password: "correct horse battery" }),
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
    });
    expect(crossSite.status).toBe(403);
    const wrongOrigin = await app.request("http://localhost/api/auth/session", {
      ...json({ password: "correct horse battery" }),
      headers: { "content-type": "application/json", origin: "https://evil.example" },
    });
    expect(wrongOrigin.status).toBe(403);
    const noBrowserHeaders = await app.request("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "correct horse battery" }),
    });
    expect(noBrowserHeaders.status).toBe(200);
  });

  test("secure cookie only with an https public url", async () => {
    const insecure = createApp(testContext());
    const a = await insecure.request(
      "/api/auth/setup",
      json({ password: "correct horse battery" }),
    );
    expect(a.headers.get("set-cookie")).not.toContain("Secure");
    const secure = createApp(testContext({ HEADROOM_PUBLIC_URL: "https://headroom.example.com" }));
    const b = await secure.request("/api/auth/setup", json({ password: "correct horse battery" }));
    expect(b.headers.get("set-cookie")).toContain("Secure");
  });
});
