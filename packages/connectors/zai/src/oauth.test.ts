import { expect, test } from "bun:test";
import { type ConnectProgress, type FetchLike, type StoredCredential } from "@headroom/core";
import { createZaiConnector } from "./index.ts";
import init from "./fixtures/oauth-init.json";
import ready from "./fixtures/oauth-ready.json";
import business from "./fixtures/business-session.json";
import customer from "./fixtures/customer.json";
import quota from "./fixtures/success.json";
import resets from "./fixtures/resets.json";
const now = 1800000000000;
const credential: StoredCredential = {
  secret: {
    kind: "oauth",
    oauthAccessToken: "synthetic-oauth-token",
    accessToken: "synthetic-business-token",
    zcodeToken: ready.data.token,
    accountId: "synthetic-customer-alpha",
    label: "Sample Z.ai Owner",
  },
  expiresAt: now + 3600000,
};
const identity = {
  providerAccountId: "zai:synthetic-customer-alpha",
  workspaceId: null,
  label: "Sample Z.ai Owner",
  assurance: "strong" as const,
};
function fixture() {
  let pollBody: unknown = ready,
    pollStatus = 200,
    initBody: unknown = init,
    businessBody: unknown = business,
    businessStatus = 200,
    customerBody: unknown = customer;
  let clock = now;
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = (input, request) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init: request });
    const body = url.endsWith("/cli/init")
      ? initBody
      : url.includes("/cli/poll/")
        ? pollBody
        : url.endsWith("/auth/z/login")
          ? businessBody
          : url.endsWith("/getCustomerInfo")
            ? customerBody
            : url.endsWith("/quota/limit")
              ? quota
              : url.endsWith("/reset/status")
                ? resets
                : null;
    if (body === null) throw new Error("Unexpected synthetic endpoint");
    const status = url.includes("/cli/poll/")
      ? pollStatus
      : url.endsWith("/auth/z/login")
        ? businessStatus
        : 200;
    return Promise.resolve(Response.json(body, { status, headers: { "retry-after": "90" } }));
  };
  return {
    client: createZaiConnector({ fetch, now: () => clock }),
    calls,
    poll: (body: unknown, status = 200) => {
      pollBody = body;
      pollStatus = status;
    },
    start: (body: unknown) => {
      initBody = body;
    },
    business: (body: unknown, status = 200) => {
      businessBody = body;
      businessStatus = status;
    },
    customer: (body: unknown) => {
      customerBody = body;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
function next(progress: ConnectProgress) {
  if (progress.status !== "next_step") throw new Error("Expected browser step");
  return progress;
}
async function begin(f: ReturnType<typeof fixture>) {
  return next(
    await f.client.beginConnect({
      attemptId: "synthetic-attempt",
      method: "approval_poll",
      expiresAt: now + 600000,
    }),
  );
}

test("Z.ai offers only browser approval, with a fresh server-only polling secret", async () => {
  const a = fixture(),
    b = fixture();
  expect(a.client.supportedMethods).toEqual(["approval_poll"]);
  const first = await begin(a),
    second = await begin(b);
  expect(first.nextStep).toMatchObject({ kind: "open_url", expiresAt: now + 300000 });
  expect(first.pollAfterMs).toBe(2000);
  const header = new Headers(a.calls[0]?.init?.headers).get("authorization");
  expect(header).toMatch(/^Bearer [a-f0-9]{64}$/);
  expect(header).not.toBe(new Headers(b.calls[0]?.init?.headers).get("authorization"));
  expect(JSON.stringify(first.nextStep)).not.toContain(header?.slice(7) ?? "missing");
  expect(
    JSON.parse(typeof a.calls[0]?.init?.body === "string" ? a.calls[0].init.body : "null"),
  ).toEqual({ provider: "zai" });
  expect(second.status).toBe("next_step");
  expect(
    await a.client.submitInput(null, { kind: "api_key", values: { apiKey: "synthetic-key" } }),
  ).toMatchObject({ status: "error" });
});
test("pending approval waits; ready approval exchanges a business session and resolves identity without creating a key", async () => {
  const f = fixture(),
    step = await begin(f);
  f.poll({ code: 0, data: { status: "pending" } });
  expect(await f.client.pollConnect(step.privateState)).toMatchObject({
    status: "waiting",
    pollAfterMs: 2000,
  });
  f.poll(ready);
  expect(await f.client.pollConnect(step.privateState)).toEqual({
    status: "credentials",
    credential,
  });
  expect(f.calls.find((c) => c.url.endsWith("/auth/z/login"))?.init?.body).toBe(
    JSON.stringify({ token: "synthetic-oauth-token" }),
  );
  expect(
    f.calls.every((c) => c.init?.redirect === "error" && c.init.signal instanceof AbortSignal),
  ).toBe(true);
  expect(f.calls.some((c) => /api_keys|access_tokens|messages|chat\/completions/.test(c.url))).toBe(
    false,
  );
  expect(credential.secret["zcodeToken"]).toBe(ready.data.token);
  expect(await f.client.identity(credential)).toEqual(identity);
  const result = await f.client.collect(credential, identity);
  expect(result.metrics.find((m) => m.providerMetricKey === "quota.18000s")?.valueText).toBe("25");
  expect(
    new Headers(f.calls.find((call) => call.url.endsWith("/quota/limit"))?.init?.headers).get(
      "authorization",
    ),
  ).toBe("Bearer synthetic-business-token");
});
test.each([
  "https://untrusted.example/api/oauth/authorize",
  "https://chat.z.ai.evil.example/api/oauth/authorize",
  "http://chat.z.ai/api/oauth/authorize",
  "https://user:password@chat.z.ai/api/oauth/authorize",
  "https://chat.z.ai:8443/api/oauth/authorize",
])("refuses an unexpected approval URL: %s", async (url) => {
  const f = fixture();
  f.start({ ...init, data: { ...init.data, authorize_url: url } });
  expect(
    await f.client.beginConnect({
      method: "approval_poll",
      attemptId: "synthetic-attempt",
      expiresAt: now + 600000,
    }),
  ).toMatchObject({ status: "error", error: { category: "invalid_response" } });
});
test("refuses a foreign OAuth client or callback without rewriting provider redirects", async () => {
  const f = fixture();
  const url = new URL(init.data.authorize_url);
  url.searchParams.set("redirect_uri", "https://untrusted.example/callback");
  f.start({ ...init, data: { ...init.data, authorize_url: url.href } });
  expect(
    await f.client.beginConnect({
      method: "approval_poll",
      attemptId: "synthetic-attempt",
      expiresAt: now + 600000,
    }),
  ).toMatchObject({ status: "error", error: { category: "invalid_response" } });
});
test("denied, expired and unknown poll replies fail safely without storing credentials", async () => {
  const f = fixture(),
    step = await begin(f);
  f.poll({ code: 0, data: { status: "failed" } });
  expect(await f.client.pollConnect(step.privateState)).toMatchObject({
    status: "error",
    error: { category: "approval_denied" },
  });
  f.poll({ code: 0, data: { status: "unknown" } });
  expect(await f.client.pollConnect(step.privateState)).toMatchObject({
    status: "error",
    error: { category: "invalid_response" },
  });
  f.advance(300000);
  const before = f.calls.length;
  expect(await f.client.pollConnect(step.privateState)).toMatchObject({
    status: "error",
    error: { category: "approval_expired" },
  });
  expect(f.calls.length).toBe(before);
});
test.each([429, 503])("a transient HTTP %s keeps approval pending", async (status) => {
  const f = fixture(),
    step = await begin(f);
  f.poll({}, status);
  expect(await f.client.pollConnect(step.privateState)).toMatchObject({ status: "waiting" });
});
test("renewal persists a new business token only for the same account", async () => {
  const f = fixture();
  f.business({
    code: 0,
    data: { accessToken: "synthetic-renewed-business-token", expires_in: 7200 },
  });
  const result = await f.client.refresh(credential);
  expect(result).toMatchObject({
    status: "refreshed",
    credential: {
      expiresAt: now + 7200000,
      secret: {
        accessToken: "synthetic-renewed-business-token",
        oauthAccessToken: "synthetic-oauth-token",
        accountId: "synthetic-customer-alpha",
      },
    },
  });
  f.customer({ code: 200, data: { customerNumber: "synthetic-other-customer" } });
  expect(await f.client.refresh(credential)).toMatchObject({
    status: "rejected",
    error: { category: "identity_mismatch" },
  });
  try {
    await f.client.collect(credential, identity);
    throw new Error("Expected identity check");
  } catch (error) {
    expect(f.client.classify(error).category).toBe("identity_mismatch");
  }
});
test("an outage or malformed renewal preserves the session; rejected sign-in requires browser reconnect", async () => {
  const f = fixture();
  f.business({}, 503);
  expect(await f.client.refresh(credential)).toMatchObject({
    status: "transient",
    error: { category: "provider_unavailable" },
  });
  f.business({ code: 200, data: {} });
  expect(await f.client.refresh(credential)).toMatchObject({
    status: "transient",
    error: { category: "invalid_response" },
  });
  f.business({}, 401);
  expect(await f.client.refresh(credential)).toMatchObject({
    status: "rejected",
    error: { category: "authentication_required" },
  });
});
test("authentication envelopes are recognized without exposing provider messages", async () => {
  const f = fixture();
  f.customer({ code: 1000, success: false, msg: "synthetic-business-token" });
  try {
    await f.client.identity(credential);
    throw new Error("Expected rejection");
  } catch (error) {
    expect(f.client.classify(error)).toMatchObject({ category: "authentication_required" });
    expect(f.client.classify(error).message).not.toContain("synthetic-business-token");
  }
});

test.each([0, -1, 10000000000])(
  "invalid or expired provider approval timing (%s) does not start polling",
  async (interval) => {
    const f = fixture();
    f.start({ ...init, data: { ...init.data, poll_interval_sec: interval } });
    expect(
      await f.client.beginConnect({
        method: "approval_poll",
        attemptId: "synthetic",
        expiresAt: now + 600000,
      }),
    ).toMatchObject({ status: "error", error: { category: "invalid_response" } });
  },
);
test("a mismatched echoed polling secret and a changed OAuth client are rejected", async () => {
  const f = fixture();
  f.start({ ...init, data: { ...init.data, poll_token: "synthetic-other-secret" } });
  expect(
    await f.client.beginConnect({
      method: "approval_poll",
      attemptId: "synthetic",
      expiresAt: now + 600000,
    }),
  ).toMatchObject({ status: "error", error: { category: "invalid_response" } });
  const url = new URL(init.data.authorize_url);
  url.searchParams.set("client_id", "synthetic-other-client");
  f.start({ ...init, data: { ...init.data, authorize_url: url.href } });
  expect(
    await f.client.beginConnect({
      method: "approval_poll",
      attemptId: "synthetic",
      expiresAt: now + 600000,
    }),
  ).toMatchObject({ status: "error", error: { category: "invalid_response" } });
});
test("root sign-in expiry requires reconnect without guessing a refresh endpoint", async () => {
  const f = fixture();
  const oauth = `e30.${Buffer.from(JSON.stringify({ exp: now / 1000 - 1 })).toString("base64url")}.synthetic`;
  expect(
    await f.client.refresh({
      ...credential,
      secret: { ...credential.secret, oauthAccessToken: oauth },
    }),
  ).toMatchObject({ status: "rejected", error: { category: "authentication_required" } });
  expect(f.calls).toHaveLength(0);
});
test("unknown session lifetime remains unknown; a reported JWT deadline is retained", async () => {
  const f = fixture();
  f.business({ code: 200, data: { access_token: "synthetic-no-expiry-business-token" } });
  expect(await f.client.refresh(credential)).toMatchObject({
    status: "refreshed",
    credential: { expiresAt: null },
  });
  const token = `e30.${Buffer.from(JSON.stringify({ exp: now / 1000 + 1200 })).toString("base64url")}.synthetic`;
  f.business({ code: 200, data: { access_token: token, expires_in: 3600 } });
  expect(await f.client.refresh(credential)).toMatchObject({
    status: "refreshed",
    credential: { expiresAt: now + 1200000 },
  });
});
test("cancel has no remote mutation and polling another attempt retains its own secret", async () => {
  const a = fixture(),
    b = fixture();
  const [first, second] = await Promise.all([begin(a), begin(b)]);
  await a.client.cancelConnect(first.privateState);
  expect(a.calls).toHaveLength(1);
  a.poll({ code: 0, data: { status: "pending" } });
  b.poll({ code: 0, data: { status: "pending" } });
  await Promise.all([
    a.client.pollConnect(first.privateState),
    b.client.pollConnect(second.privateState),
  ]);
  expect(new Headers(a.calls[0]?.init?.headers).get("authorization")).toBe(
    new Headers(a.calls[1]?.init?.headers).get("authorization"),
  );
  expect(new Headers(a.calls[1]?.init?.headers).get("authorization")).not.toBe(
    new Headers(b.calls[1]?.init?.headers).get("authorization"),
  );
});

test("browser approval retains its ZCode token for reset-card reads, and business renewal preserves it", async () => {
  const f = fixture(),
    step = await begin(f),
    result = await f.client.pollConnect(step.privateState);
  expect(result).toMatchObject({
    status: "credentials",
    credential: { secret: { zcodeToken: ready.data.token } },
  });
  const renewed = await f.client.refresh({
    ...credential,
    secret: { ...credential.secret, zcodeToken: ready.data.token },
  });
  expect(renewed).toMatchObject({
    status: "refreshed",
    credential: { secret: { zcodeToken: ready.data.token } },
  });
  expect(JSON.stringify(step.nextStep)).not.toContain(ready.data.token);
});
