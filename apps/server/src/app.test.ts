import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createApp } from "./app.ts";
import { cookiesFrom, jsonPost, owner, testContext, url } from "./test-helpers.ts";

const setupSchema = z.object({ ownerExists: z.boolean(), minimumPasswordLength: z.number() });

async function signUp(ctx = testContext()) {
  const app = createApp(ctx);
  const response = await app.request(url(ctx, "/api/auth/sign-up/email"), jsonPost(ctx, owner));
  return { ctx, app, response, cookie: cookiesFrom(response) };
}

describe("public routes", () => {
  test("healthz and setup are public; setup reports no owner", async () => {
    const ctx = testContext();
    const app = createApp(ctx);
    expect((await app.request(url(ctx, "/healthz"))).status).toBe(200);
    const setup = await app.request(url(ctx, "/api/setup"));
    expect(setupSchema.parse(await setup.json()).ownerExists).toBe(false);
    expect((await app.request(url(ctx, "/api/me"))).status).toBe(401);
  });

  test("security headers restrict framing to trusted origins", async () => {
    const ctx = testContext({ HEADROOM_TRUSTED_ORIGINS: "https://app.example.com" });
    const response = await createApp(ctx).request(url(ctx, "/healthz"));
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'self' http://localhost:8080 https://app.example.com");
    expect(csp).toContain("object-src 'none'");
    expect(response.headers.get("x-frame-options")).toBeNull();
  });
});

describe("owner sign-up and sign-in", () => {
  test("first sign-up creates the owner and signs in; second is refused", async () => {
    const { ctx, app, response, cookie } = await signUp();
    expect(response.status).toBe(200);
    expect(cookie).toContain("headroom.session_token=");
    expect(response.headers.getSetCookie().join(";")).toContain("HttpOnly");

    const setup = await app.request(url(ctx, "/api/setup"));
    expect(setupSchema.parse(await setup.json()).ownerExists).toBe(true);

    const me = await app.request(url(ctx, "/api/me"), { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(z.object({ email: z.string() }).parse(await me.json()).email).toBe(owner.email);

    const second = await app.request(
      url(ctx, "/api/auth/sign-up/email"),
      jsonPost(ctx, { ...owner, email: "second@example.com", username: "second" }),
    );
    expect(second.status).toBe(403);
  });

  test("short passwords are refused", async () => {
    const ctx = testContext();
    const app = createApp(ctx);
    const response = await app.request(
      url(ctx, "/api/auth/sign-up/email"),
      jsonPost(ctx, { ...owner, password: "short" }),
    );
    expect(response.status).toBe(400);
  });

  test("username sign-in, wrong password, sign-out", async () => {
    const { ctx, app } = await signUp();
    const bad = await app.request(
      url(ctx, "/api/auth/sign-in/username"),
      jsonPost(ctx, { username: owner.username, password: "wrong password here" }),
    );
    expect(bad.status).toBe(401);
    const ok = await app.request(
      url(ctx, "/api/auth/sign-in/username"),
      jsonPost(ctx, { username: owner.username, password: owner.password }),
    );
    expect(ok.status).toBe(200);
    const cookie = cookiesFrom(ok);
    expect((await app.request(url(ctx, "/api/me"), { headers: { cookie } })).status).toBe(200);
    const out = await app.request(url(ctx, "/api/auth/sign-out"), jsonPost(ctx, {}, { cookie }));
    expect(out.status).toBe(200);
    const after = await app.request(url(ctx, "/api/me"), {
      headers: { cookie: cookiesFrom(out) || cookie },
    });
    expect(after.status).toBe(401);
  });

  test("passkey registration options require a session", async () => {
    const { ctx, app, cookie } = await signUp();
    const anonymous = await app.request(url(ctx, "/api/auth/passkey/generate-register-options"), {
      headers: { origin: url(ctx, "") },
    });
    expect(anonymous.status).toBe(401);
    const options = await app.request(url(ctx, "/api/auth/passkey/generate-register-options"), {
      headers: { cookie, origin: url(ctx, "") },
    });
    expect(options.status).toBe(200);
    const body = z
      .object({ challenge: z.string(), rp: z.object({ id: z.string(), name: z.string() }) })
      .parse(await options.json());
    expect(body.rp).toEqual({ id: "localhost", name: "Headroom" });
  });
});

describe("origins", () => {
  test("untrusted origin is refused by Better Auth and by Headroom routes", async () => {
    const { ctx, app } = await signUp();
    const evil = { origin: "https://evil.example" };
    const auth = await app.request(
      url(ctx, "/api/auth/sign-in/username"),
      jsonPost(ctx, { username: owner.username, password: owner.password }, evil),
    );
    expect(auth.status).toBe(403);
    const cross = await app.request(url(ctx, "/api/me"), {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(cross.status).toBe(403);
  });

  test("trusted origins get CORS credentials", async () => {
    const ctx = testContext({ HEADROOM_TRUSTED_ORIGINS: "https://app.example.com" });
    const app = createApp(ctx);
    const allowed = await app.request(url(ctx, "/api/setup"), {
      headers: { origin: "https://app.example.com" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    const denied = await app.request(url(ctx, "/api/setup"), {
      headers: { origin: "https://evil.example" },
    });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("secure cookies and HSTS only under an https public url", async () => {
    const insecure = await signUp();
    expect(insecure.response.headers.getSetCookie().join(";")).not.toContain("Secure");
    expect(insecure.response.headers.get("strict-transport-security")).toBeNull();
    const secure = await signUp(
      testContext({ HEADROOM_PUBLIC_URL: "https://headroom.example.com" }),
    );
    expect(secure.response.status).toBe(200);
    expect(secure.response.headers.getSetCookie().join(";")).toContain("Secure");
    expect(secure.response.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });
});

describe("rate limiting", () => {
  test("repeated failed sign-ins from one address are throttled", async () => {
    const ctx = testContext({}, { rateLimit: true });
    const app = createApp(ctx);
    await app.request(
      url(ctx, "/api/auth/sign-up/email"),
      jsonPost(ctx, owner, { "x-forwarded-for": "203.0.113.7" }),
    );
    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const response = await app.request(
        url(ctx, "/api/auth/sign-in/username"),
        jsonPost(
          ctx,
          { username: owner.username, password: "wrong password here" },
          { "x-forwarded-for": "203.0.113.7" },
        ),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});
