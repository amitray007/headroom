import { expect, test } from "bun:test";
import type { ConnectProgress, FetchLike, StoredCredential } from "@headroom/core";
import { createKimiConnector } from "./index.ts";
import device from "./fixtures/device.json";
import token from "./fixtures/token.json";
import usage from "./fixtures/usage.json";

const now = 1_794_000_000_000;
const credential: StoredCredential = {
  secret: {
    kind: "oauth",
    region: "global",
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    deviceId: "synthetic-device-id",
  },
  expiresAt: now + 3600_000,
};
const identity = {
  providerAccountId: "global:synthetic-owner",
  workspaceId: null,
  label: "Sample",
  assurance: "strong" as const,
};

function transport() {
  const calls: { url: string; init?: RequestInit }[] = [];
  let pollBody: unknown = token;
  let pollStatus = 200;
  let deviceBody: unknown = device;
  const fetch: FetchLike = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(init === undefined ? { url } : { url, init });
    let body = url.endsWith("device_authorization")
      ? deviceBody
      : url.endsWith("/token")
        ? pollBody
        : url.endsWith("/me")
          ? { user_id: "synthetic-owner" }
          : usage;
    if (url.includes("auth.kimi.com") && url.endsWith("device_authorization"))
      body = {
        ...device,
        verification_uri: "https://www.kimi.com/code/authorize_device",
        verification_uri_complete:
          "https://www.kimi.com/code/authorize_device?user_code=SAMPLE-CODE",
      };
    return Promise.resolve(
      Response.json(body, {
        status: url.endsWith("/token") ? pollStatus : 200,
        headers: { "retry-after": "90" },
      }),
    );
  };
  return {
    fetch,
    calls,
    poll: (body: unknown, status = 200) => {
      pollBody = body;
      pollStatus = status;
    },
    device: (body: unknown) => {
      deviceBody = body;
    },
  };
}

function next(progress: ConnectProgress) {
  if (progress.status !== "next_step")
    throw new Error(`Expected next step, got ${progress.status}`);
  return progress;
}

async function begin(connector: ReturnType<typeof createKimiConnector>, region = "global") {
  const pick = next(
    await connector.beginConnect({
      method: "device_code",
      attemptId: "synthetic-attempt",
      expiresAt: now + 900_000,
    }),
  );
  return next(await connector.submitInput(pick.privateState, { kind: "selection", id: region }));
}

test("Kimi offers one browser sign-in method, with no key or pasted session", async () => {
  const http = transport();
  const connector = createKimiConnector({ fetch: http.fetch, now: () => now });
  expect(connector.supportedMethods).toEqual(["device_code"]);
  const step = await begin(connector);
  expect(step.nextStep).toMatchObject({
    kind: "device_code",
    userCode: device.user_code,
    verificationUrl: device.verification_uri_complete,
    expiresAt: now + 600_000,
  });
  expect(JSON.stringify(step.nextStep)).not.toContain(device.device_code);
  expect(step.pollAfterMs).toBe(5000);
  const request = http.calls[0];
  expect(request?.url).toBe("https://auth.kimi.ai/api/oauth/device_authorization");
  expect(
    new URLSearchParams(typeof request?.init?.body === "string" ? request.init.body : "").get(
      "client_id",
    ),
  ).toBe("17e5f671-d194-4dfb-9706-5516cb48c098");
  expect(new Headers(request?.init?.headers).get("x-msh-platform")).toBe("headroom");
  const connected = await connector.pollConnect(step.privateState);
  expect(connected).toMatchObject({
    status: "credentials",
    credential: {
      expiresAt: now + 3600_000,
      secret: {
        kind: "oauth",
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        region: "global",
      },
    },
  });
  const headers = http.calls.map((c) => new Headers(c.init?.headers));
  expect(headers[1]?.get("x-msh-device-id")).toBe(headers[0]?.get("x-msh-device-id"));
  expect(http.calls.every((c) => c.init?.redirect === "error")).toBe(true);
  expect(
    await connector.beginConnect({ method: "api_key", attemptId: "obsolete", expiresAt: now }),
  ).toMatchObject({ status: "error" });
});

test("one OAuth session supplies identity, session and weekly usage without monthly stats", async () => {
  const http = transport();
  const connector = createKimiConnector({ fetch: http.fetch, now: () => now });
  expect((await connector.identity(credential)).providerAccountId).toBe(identity.providerAccountId);
  const result = await connector.collect(credential, identity);
  expect(result.failures).toEqual([]);
  expect(result.metrics.map((m) => m.providerMetricKey)).toEqual([
    "quota.five_hour",
    "quota.weekly",
  ]);
  expect((await connector.capabilities(credential, identity)).map((c) => c.metricOrAction)).toEqual(
    ["quota.five_hour", "quota.weekly"],
  );
  expect(http.calls.every((c) => c.url.startsWith("https://api.kimi.ai/coding/v1/"))).toBe(true);
  expect(
    http.calls.every(
      (c) => new Headers(c.init?.headers).get("authorization") === `Bearer ${token.access_token}`,
    ),
  ).toBe(true);
  expect(http.calls.every((c) => new Headers(c.init?.headers).get("cookie") === null)).toBe(true);
  expect(
    await connector
      .collect(credential, { ...identity, providerAccountId: "global:another-owner" })
      .catch((e: unknown) => e),
  ).toMatchObject({ category: "identity_mismatch" });
});

test("pending, slow-down and throttling keep the private device state and polling interval", async () => {
  const http = transport();
  const connector = createKimiConnector({ fetch: http.fetch, now: () => now });
  const step = await begin(connector);
  http.poll(
    { error: "authorization_pending", error_description: "synthetic-secret-never-log" },
    400,
  );
  expect(await connector.pollConnect(step.privateState)).toMatchObject({
    status: "waiting",
    pollAfterMs: 5000,
  });
  http.poll({ error: "slow_down" }, 400);
  const slowed = await connector.pollConnect(step.privateState);
  expect(slowed).toMatchObject({ status: "waiting", pollAfterMs: 10_000 });
  http.poll({}, 429);
  expect(await connector.pollConnect(step.privateState)).toMatchObject({
    status: "waiting",
    pollAfterMs: 90_000,
  });
});

test("denied and expired approvals are sanitized, and local expiry makes no further request", async () => {
  const http = transport();
  let clock = now;
  const connector = createKimiConnector({ fetch: http.fetch, now: () => clock });
  const step = await begin(connector);
  await Promise.all(
    [
      ["access_denied", "approval_denied"],
      ["expired_token", "approval_expired"],
    ].map(async ([error, category]) => {
      const denied = transport();
      const denial = createKimiConnector({ fetch: denied.fetch, now: () => now });
      const pending = await begin(denial);
      denied.poll({ error, error_description: token.access_token }, 400);
      const progress = await denial.pollConnect(pending.privateState);
      expect(progress).toMatchObject({ status: "error", error: { category } });
      expect(JSON.stringify(progress)).not.toContain(token.access_token);
    }),
  );
  clock = now + 601_000;
  const count = http.calls.length;
  expect(await connector.pollConnect(step.privateState)).toMatchObject({
    status: "error",
    error: { category: "approval_expired" },
  });
  expect(http.calls).toHaveLength(count);
});

test("regional sign-in and refresh never fall back or follow a returned foreign approval URL", async () => {
  const http = transport();
  const connector = createKimiConnector({ fetch: http.fetch, now: () => now });
  const step = await begin(connector, "mainland-cn");
  await connector.pollConnect(step.privateState);
  expect(http.calls.every((c) => new URL(c.url).hostname === "auth.kimi.com")).toBe(true);
  http.device({ ...device, verification_uri_complete: "https://example.com/steal" });
  const pick = next(
    await connector.beginConnect({
      method: "device_code",
      attemptId: "invalid-host",
      expiresAt: now + 900_000,
    }),
  );
  expect(
    await connector.submitInput(pick.privateState, { kind: "selection", id: "global" }),
  ).toMatchObject({ status: "error", error: { category: "invalid_response" } });
});

test("website approval accepts the regional website while rejecting lookalikes, URL credentials and other origins", async () => {
  await Promise.all(
    [
      "http://www.kimi.ai/code/authorize_device",
      "https://owner:synthetic-password@www.kimi.ai/code/authorize_device",
      "https://www.kimi.ai.evil.example/code/authorize_device",
      "https://www.kimi.ai:444/code/authorize_device",
      "https://www.kimi.com/code/authorize_device",
    ].map(async (verification_uri_complete) => {
      const http = transport();
      http.device({ ...device, verification_uri_complete });
      const connector = createKimiConnector({ fetch: http.fetch, now: () => now });
      const pick = next(
        await connector.beginConnect({
          method: "device_code",
          attemptId: "invalid-origin",
          expiresAt: now + 900_000,
        }),
      );
      expect(
        await connector.submitInput(pick.privateState, { kind: "selection", id: "global" }),
      ).toMatchObject({ status: "error", error: { category: "invalid_response" } });
      expect(http.calls).toHaveLength(1);
      expect(http.calls[0]?.url).toBe("https://auth.kimi.ai/api/oauth/device_authorization");
    }),
  );
  const http = transport();
  http.device({
    ...device,
    verification_uri_complete: "https://auth.kimi.ai/verify?user_code=SAMPLE-CODE",
  });
  const connector = createKimiConnector({ fetch: http.fetch, now: () => now });
  expect((await begin(connector)).nextStep).toMatchObject({
    kind: "device_code",
    verificationUrl: "https://auth.kimi.ai/verify?user_code=SAMPLE-CODE",
  });
});

test("refresh rotates the OAuth session on the same device and classifies rejection versus retry", async () => {
  const http = transport();
  const connector = createKimiConnector({ fetch: http.fetch, now: () => now });
  http.poll({
    ...token,
    access_token: "synthetic-new-access",
    refresh_token: "synthetic-new-refresh",
    expires_in: "7200",
  });
  expect(await connector.refresh(credential)).toMatchObject({
    status: "refreshed",
    credential: {
      expiresAt: now + 7200_000,
      secret: {
        accessToken: "synthetic-new-access",
        refreshToken: "synthetic-new-refresh",
        deviceId: "synthetic-device-id",
      },
    },
  });
  const body = new URLSearchParams(
    typeof http.calls[0]?.init?.body === "string" ? http.calls[0].init.body : "",
  );
  expect(body.get("grant_type")).toBe("refresh_token");
  expect(body.get("refresh_token")).toBe(token.refresh_token);
  http.poll({ error: "invalid_grant", error_description: token.refresh_token }, 400);
  const rejected = await connector.refresh(credential);
  expect(rejected).toMatchObject({ status: "rejected" });
  expect(JSON.stringify(rejected)).not.toContain(token.refresh_token);
  http.poll({}, 503);
  expect(await connector.refresh(credential)).toMatchObject({ status: "transient" });
  http.poll({}, 429);
  expect(await connector.refresh(credential)).toMatchObject({
    status: "transient",
    error: { category: "rate_limited", retryAfterMs: 90_000 },
  });
});

test("concurrent OAuth accounts keep access tokens, device identities and quota readings separate", async () => {
  const connector = createKimiConnector({
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      const first =
        new Headers(init?.headers).get("authorization") === `Bearer ${token.access_token}`;
      expect(new Headers(init?.headers).get("x-msh-device-id")).toBe(
        first ? "synthetic-device-id" : "second-device-id",
      );
      return Promise.resolve(
        Response.json(
          url.endsWith("/me")
            ? { user_id: first ? "synthetic-owner" : "second-owner" }
            : { usages: { limit_5h: { used_ratio: first ? 0.2 : 0.8 } } },
        ),
      );
    },
  });
  const [one, two] = await Promise.all([
    connector.collect(credential, identity),
    connector.collect(
      {
        ...credential,
        secret: {
          ...credential.secret,
          accessToken: "synthetic-second-access",
          deviceId: "second-device-id",
        },
      },
      { ...identity, providerAccountId: "global:second-owner" },
    ),
  ]);
  expect(one.metrics[0]?.valueText).toBe("20");
  expect(two.metrics[0]?.valueText).toBe("80");
});
