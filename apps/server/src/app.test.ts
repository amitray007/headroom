import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { clientAddress, createApp } from "./app.ts";
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

describe("built web UI", () => {
  test("brand files are served as files; other paths fall back to index.html", async () => {
    const dir = mkdtempSync(join(tmpdir(), "headroom-web-"));
    try {
      writeFileSync(join(dir, "index.html"), "<!doctype html><title>shell</title>");
      writeFileSync(join(dir, "favicon.ico"), "ico");
      writeFileSync(join(dir, "favicon.svg"), "<svg/>");
      writeFileSync(join(dir, "manifest.webmanifest"), '{"name":"Headroom"}');
      const ctx = testContext({ HEADROOM_WEB_DIR: dir });
      const app = createApp(ctx);

      const ico = await app.request(url(ctx, "/favicon.ico"));
      expect(ico.status).toBe(200);
      expect(await ico.text()).toBe("ico");
      const svg = await app.request(url(ctx, "/favicon.svg"));
      expect(svg.headers.get("content-type")).toContain("image/svg+xml");
      const manifest = await app.request(url(ctx, "/manifest.webmanifest"));
      expect(await manifest.text()).toContain("Headroom");

      const route = await app.request(url(ctx, "/settings"));
      expect(await route.text()).toContain("shell");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

/** Run `count` requests one after another; rate limiting depends on order, so no Promise.all. */
async function sequentialStatuses(
  count: number,
  request: () => Promise<Response> | Response,
): Promise<number[]> {
  if (count === 0) return [];
  const response = await request();
  const rest = await sequentialStatuses(count - 1, request);
  return [response.status, ...rest];
}

describe("rate limiting", () => {
  test("repeated failed sign-ins from one address are throttled", async () => {
    const ctx = testContext({}, { rateLimit: true });
    const app = createApp(ctx);
    const from = { "x-forwarded-for": "203.0.113.7" };
    await app.request(url(ctx, "/api/auth/sign-up/email"), jsonPost(ctx, owner, from));
    const statuses = await sequentialStatuses(7, () =>
      app.request(
        url(ctx, "/api/auth/sign-in/username"),
        jsonPost(ctx, { username: owner.username, password: "wrong password here" }, from),
      ),
    );
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

describe("client address", () => {
  test("ignores forwarded headers unless the proxy is trusted; never trusts the internal header", () => {
    const request = new Request("http://localhost/", {
      headers: {
        "x-forwarded-for": "198.51.100.9, 10.0.0.1",
        "x-headroom-client-ip": "203.0.113.1",
      },
    });
    expect(clientAddress(request, false, () => "127.0.0.1")).toBe("127.0.0.1");
    expect(clientAddress(request, true, () => "127.0.0.1")).toBe("198.51.100.9");
    expect(clientAddress(new Request("http://localhost/"), true, () => null)).toBe("unknown");
  });
});
