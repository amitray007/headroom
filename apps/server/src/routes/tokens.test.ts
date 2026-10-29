import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createApp, version } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

const createdSchema = z.object({ id: z.string(), name: z.string(), key: z.string() });
const listSchema = z.object({
  tokens: z.array(
    z
      .object({
        id: z.string(),
        name: z.string(),
        prefix: z.string(),
        start: z.string(),
        createdAt: z.number(),
        lastUsedAt: z.number().nullable(),
        expiresAt: z.number().nullable(),
      })
      .strict(),
  ),
});

async function fixture(options: Parameters<typeof testContext>[1] = {}) {
  const ctx = testContext({}, options);
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const response = await app.request(
    url(ctx, "/api/tokens"),
    jsonPost(ctx, { name: "Test Mac" }, { cookie }),
  );
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const token = createdSchema.parse(await response.json());
  const headers = { authorization: `Bearer ${token.key}` };
  return { ctx, app, cookie, token, headers };
}

const concrete = (path: string): string => path.replace(/:[^/]+/g, "synthetic-id");

describe("read-only API tokens", () => {
  test("read scope reaches whoami, HEAD works, cookies and alternate key headers do not", async () => {
    const { ctx, app, headers, cookie, token } = await fixture();
    const response = await app.request(url(ctx, "/api/app/v1/whoami"), { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      apiVersion: 1,
      serverVersion: version,
      tokenName: "Test Mac",
    });
    const head = await app.request(url(ctx, "/api/app/v1/whoami"), { method: "HEAD", headers });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    await Promise.all(
      [
        { cookie },
        { "x-api-key": token.key },
        { authorization: token.key },
        { authorization: `Basic ${token.key}` },
      ].map(async (invalid) => {
        expect(
          (await app.request(url(ctx, "/api/app/v1/whoami"), { headers: invalid })).status,
        ).toBe(401);
      }),
    );
    ctx.sqlite.close();
  });

  test("every registered session route, including every mutation, rejects a token", async () => {
    const { ctx, app, headers } = await fixture();
    const routes = new Set(
      app.routes
        .filter(
          (route) =>
            route.method !== "ALL" &&
            route.path.startsWith("/api/") &&
            !route.path.startsWith("/api/auth/") &&
            !route.path.startsWith("/api/app/") &&
            route.path !== "/api/setup",
        )
        .map((route) => `${route.method} ${concrete(route.path)}`),
    );
    expect(routes.size).toBeGreaterThan(25);
    await Promise.all(
      [...routes].map(async (route) => {
        const [method, path] = route.split(" ");
        if (!method || !path) throw new Error("Invalid route");
        const response = await app.request(url(ctx, path), { method, headers });
        expect({ route, status: response.status }).toEqual({ route, status: 401 });
        expect(await response.json()).toEqual({ error: "authentication_required" });
      }),
    );
    // Better Auth expands a wildcard internally. Check every endpoint that requires a session
    // before body validation, and prove neither of its key header forms creates a session.
    const authChecks = Object.values(ctx.auth.api).flatMap((endpoint) => {
      if (!endpoint.path) return [];
      const path = `/api/auth${concrete(endpoint.path)}`;
      const methods = Array.isArray(endpoint.options.method)
        ? endpoint.options.method
        : [endpoint.options.method];
      return methods.map(async (method) => {
        const init = method === "POST" ? jsonPost(ctx, {}) : { method };
        const anonymous = await app.request(url(ctx, path), init);
        if (anonymous.status !== 401) return false;
        expect(
          (
            await app.request(url(ctx, path), {
              ...init,
              headers: { "content-type": "application/json", ...headers },
            })
          ).status,
        ).toBe(401);
        return true;
      });
    });
    expect((await Promise.all(authChecks)).filter(Boolean).length).toBeGreaterThan(4);
    await Promise.all(
      [headers, { "x-api-key": headers.authorization.slice(7) }].map(async (keyHeaders) => {
        const response = await app.request(url(ctx, "/api/auth/get-session"), {
          headers: keyHeaders,
        });
        expect(await response.json()).toBeNull();
      }),
    );
    ctx.sqlite.close();
  });

  test("all unsafe methods and OPTIONS under the app namespace get JSON 405", async () => {
    const { ctx, app, headers, cookie } = await fixture();
    await Promise.all(
      ["/api/app/v1/whoami", "/api/app/v1/future"].flatMap((path) =>
        ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"].flatMap((method) =>
          [headers, { cookie }].map(async (auth) => {
            const response = await app.request(url(ctx, path), {
              method,
              headers: { ...auth, "sec-fetch-site": "cross-site" },
            });
            expect(response.status).toBe(405);
            expect(response.headers.get("allow")).toBe("GET, HEAD");
            expect(await response.json()).toEqual({ error: "method_not_allowed" });
          }),
        ),
      ),
    );
    ctx.sqlite.close();
  });

  test("list is a safe projection, shows use, and revocation is immediate", async () => {
    const { ctx, app, headers, cookie, token } = await fixture();
    const stored = ctx.sqlite
      .query<{ key: string; permissions: string }, [string]>(
        "SELECT key, permissions FROM apikey WHERE id = ?",
      )
      .get(token.id);
    expect(stored?.key).not.toBe(token.key);
    expect(JSON.parse(stored?.permissions ?? "null")).toEqual({ app: ["read"] });
    await app.request(url(ctx, "/api/app/v1/whoami"), { headers });
    const response = await app.request(url(ctx, "/api/tokens"), { headers: { cookie } });
    const text = await response.text();
    expect(text).not.toContain(token.key);
    expect(text).not.toContain(stored?.key ?? "missing");
    const listed = listSchema.parse(JSON.parse(text)).tokens[0];
    expect(listed).toMatchObject({
      id: token.id,
      name: "Test Mac",
      prefix: "hr_",
      start: token.key.slice(0, 11),
      expiresAt: null,
    });
    expect(listed?.lastUsedAt).toBeNumber();
    expect(
      (
        await app.request(url(ctx, `/api/tokens/${token.id}`), {
          method: "DELETE",
          headers: { cookie },
        })
      ).status,
    ).toBe(200);
    expect((await app.request(url(ctx, "/api/app/v1/whoami"), { headers })).status).toBe(401);
    const after = await app.request(url(ctx, "/api/tokens"), { headers: { cookie } });
    expect(await after.json()).toEqual({ tokens: [] });
    ctx.sqlite.close();
  });

  test("expired, disabled and unscoped keys cannot read", async () => {
    await Promise.all(
      [
        "expires_at = 1",
        "enabled = 0",
        "permissions = '{}'",
        'permissions = \'{"app":["write"]}\'',
      ].map(async (update) => {
        const { ctx, app, headers, token } = await fixture();
        ctx.sqlite.run(`UPDATE apikey SET ${update} WHERE id = ?`, [token.id]);
        expect((await app.request(url(ctx, "/api/app/v1/whoami"), { headers })).status).toBe(401);
        ctx.sqlite.close();
      }),
    );
  });

  test("management validates names, checks origin, and blocks plugin HTTP management", async () => {
    const { ctx, app, cookie, token } = await fixture();
    await Promise.all(
      [
        { name: "" },
        { name: "   " },
        { name: "x".repeat(41) },
        { name: 4 },
        { name: "Mac", permissions: { app: ["write"] } },
        null,
      ].map(async (body) => {
        expect(
          (await app.request(url(ctx, "/api/tokens"), jsonPost(ctx, body, { cookie }))).status,
        ).toBe(400);
      }),
    );
    expect(
      (
        await app.request(
          url(ctx, "/api/tokens"),
          jsonPost(ctx, { name: "Mac" }, { cookie, "sec-fetch-site": "cross-site" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(url(ctx, `/api/tokens/${token.id}`), {
          method: "DELETE",
          headers: { cookie, origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          url(ctx, "/api/auth/api-key/create"),
          jsonPost(ctx, { name: "Mac", permissions: { app: ["write"] } }, { cookie }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await app.request(url(ctx, "/api/auth/api-key/list"), { headers: { cookie } })).status,
    ).toBe(404);
    expect(
      (
        await app.request(url(ctx, "/api/tokens/missing"), {
          method: "DELETE",
          headers: { cookie },
        })
      ).status,
    ).toBe(404);
    ctx.sqlite.close();
  });

  test("concurrent failed guesses also reach the address limit", async () => {
    const { ctx, app } = await fixture();
    const attempts = await Promise.all(
      Array.from({ length: 10 }, async (_, attempt) =>
        app.request(url(ctx, "/api/app/v1/whoami"), {
          headers: { authorization: `Bearer invalid-${attempt}` },
        }),
      ),
    );
    expect(attempts.every((response) => response.status === 401)).toBe(true);
    expect((await app.request(url(ctx, "/api/app/v1/whoami"))).status).toBe(429);
    ctx.sqlite.close();
  });

  test("failed guesses share an address limit, ignore spoofed forwarding, then recover", async () => {
    let now = new Date();
    const { ctx, app, headers } = await fixture({ now: () => now });
    // Requests are chained: the next guess must observe the previous failed count.
    await Array.from({ length: 10 }, (_, attempt) => attempt).reduce(async (previous, attempt) => {
      await previous;
      const response = await app.request(url(ctx, "/api/app/v1/whoami"), {
        headers: {
          authorization: `Bearer invalid-${attempt}`,
          "x-forwarded-for": `192.0.2.${attempt}`,
          "x-headroom-client-ip": `192.0.2.${attempt}`,
        },
      });
      expect(response.status).toBe(401);
    }, Promise.resolve());
    const blocked = await app.request(url(ctx, "/api/app/v1/whoami"), { headers });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    now = new Date(now.getTime() + 60_001);
    expect((await app.request(url(ctx, "/api/app/v1/whoami"), { headers })).status).toBe(200);
    ctx.sqlite.close();
  });
});
