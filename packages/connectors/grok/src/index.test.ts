import { describe, expect, test } from "bun:test";

import type { CliLoginStatus, LoginRunner } from "@headroom/core";

import { billingUrl, settingsUrl, tokenUrl } from "./endpoints.ts";
import billingZero from "./fixtures/billing-zero.json";
import billingLiveShape from "./fixtures/billing-live-shape.json";
import billingFixture from "./fixtures/billing.json";
import { createGrokConnector, credentialFromAuthFile, parseDeviceStep } from "./index.ts";

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
function jwt(payload: Record<string, unknown>): string {
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}
const token = jwt({ sub: "user_synthetic", email: "owner@example.com", exp: 1_700_003_600 });
const authFile = JSON.stringify({
  "grok-session": {
    key: token,
    refresh_token: "refresh-synthetic",
    oidc_client_id: "client-synthetic",
    expires_at: "2026-10-01T00:00:00Z",
  },
});

class FakeRunner implements LoginRunner {
  readonly started: string[] = [];
  readonly cleaned: string[] = [];
  output = "";
  state: CliLoginStatus["state"] = "running";
  credentials: string | null = null;
  start(spec: { attemptId: string }): void {
    this.started.push(spec.attemptId);
  }
  status(): CliLoginStatus {
    return {
      state: this.state,
      exitCode: null,
      output: this.output,
      credentialsPresent: this.credentials !== null,
    };
  }
  readCredentials(): string | null {
    return this.credentials;
  }
  cleanup(id: string): Promise<void> {
    this.cleaned.push(id);
    return Promise.resolve();
  }
  kill(): Promise<void> {
    return Promise.resolve();
  }
  write(): void {
    // unused
  }
}

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const impl = (url: string) => {
    calls.push(url);
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    return Promise.resolve(match ? routes[match]!() : new Response("nf", { status: 404 }));
  };
  return { fetch: impl, calls };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const deviceOutput = `
To sign in, open this URL in your browser:

  https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH

Confirm this code in your browser:

  ABCD-EFGH

Waiting for authorization...
`;

const identity = {
  providerAccountId: "user_synthetic",
  workspaceId: null,
  label: "x",
  assurance: "strong" as const,
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("Grok connector", () => {
  test("parses the device URL and code the CLI prints", () => {
    expect(parseDeviceStep(deviceOutput)).toEqual({
      url: "https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH",
      code: "ABCD-EFGH",
    });
    expect(parseDeviceStep("nothing yet")).toBeNull();
  });

  test("auth.json yields a credential with the entry's client id and token expiry", () => {
    const credential = credentialFromAuthFile(authFile);
    expect(credential.secret).toMatchObject({
      refreshToken: "refresh-synthetic",
      clientId: "client-synthetic",
    });
    expect(credential.expiresAt).toBe(1_700_003_600_000);
    expect(() => credentialFromAuthFile("{}")).toThrow(/auth\.json/);
    expect(() => credentialFromAuthFile("nope")).toThrow(/JSON/);
  });

  test("cli login: begin shows the code, poll waits, credentials complete the attempt", async () => {
    const runner = new FakeRunner();
    runner.output = deviceOutput;
    const connector = createGrokConnector({
      runner,
      fetch: fakeFetch({}).fetch,
      now: () => 1_700_000_000_000,
    });
    const begun = await connector.beginConnect({
      attemptId: "g1",
      method: "cli_login",
      expiresAt: 1_700_000_900_000,
    });
    expect(begun).toMatchObject({
      status: "next_step",
      nextStep: { kind: "device_code", userCode: "ABCD-EFGH" },
    });
    expect((await connector.pollConnect({ attemptId: "g1" })).status).toBe("waiting");
    runner.credentials = authFile;
    expect((await connector.pollConnect({ attemptId: "g1" })).status).toBe("credentials");
    expect(runner.cleaned).toEqual(["g1"]);
  });

  test("identity uses the token subject and the plan from settings", async () => {
    const http = fakeFetch({
      [settingsUrl]: () => json({ subscription_tier_display: "SuperGrok" }),
    });
    const connector = createGrokConnector({ runner: new FakeRunner(), fetch: http.fetch });
    expect(await connector.identity(credentialFromAuthFile(authFile))).toEqual({
      providerAccountId: "user_synthetic",
      workspaceId: null,
      label: "owner@example.com (SuperGrok)",
      assurance: "strong",
    });
  });

  test("the live billing shape of 2026-10-01 adds on-demand spend, prepaid balance and per-product percentages", async () => {
    const connector = createGrokConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({ [billingUrl]: () => json(billingLiveShape) }).fetch,
    });
    const result = await connector.collect(credentialFromAuthFile(authFile), identity);
    const byKey = Object.fromEntries(result.metrics.map((m) => [m.providerMetricKey, m]));
    expect(byKey["weekly_pool.used_percent"]).toMatchObject({
      valueText: "1",
      resetsAt: Date.parse("2026-10-02T05:53:50Z"),
    });
    expect(byKey["on_demand.used"]).toMatchObject({
      valueText: "0",
      kind: "spend",
      unit: "grok_credits",
    });
    expect(byKey["prepaid_balance"]).toMatchObject({ valueText: "0", kind: "credits" });
    expect(byKey["product.grok_code.used_percent"]).toMatchObject({ valueText: "1" });
    expect(byKey["product.grok_chat.used_percent"]).toMatchObject({ valueText: "0" });
    expect(result.metrics.every((m) => m.availability === "available")).toBe(true);
  });

  test("collect maps the weekly pool and cap; an absent percent is a genuine zero", async () => {
    const connector = createGrokConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({ [billingUrl]: () => json(billingFixture) }).fetch,
      now: () => 1_700_000_000_000,
    });
    const result = await connector.collect(credentialFromAuthFile(authFile), identity);
    expect(result.failures).toEqual([]);
    const pool = result.metrics.find((m) => m.providerMetricKey === "weekly_pool.used_percent");
    expect(pool).toMatchObject({
      valueText: "37.5",
      availability: "available",
      scope: "window:weekly",
    });
    expect(pool?.resetsAt).toBe(Date.parse("2026-10-03T04:01:09.238389+00:00"));
    expect(result.metrics.find((m) => m.providerMetricKey === "on_demand_cap")).toMatchObject({
      valueText: "2500",
      kind: "spending_cap",
    });

    const zero = createGrokConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({ [billingUrl]: () => json(billingZero) }).fetch,
    });
    const zeroResult = await zero.collect(credentialFromAuthFile(authFile), identity);
    expect(
      zeroResult.metrics.find((m) => m.providerMetricKey === "weekly_pool.used_percent"),
    ).toMatchObject({ valueText: "0" });
    expect(zeroResult.metrics.find((m) => m.providerMetricKey === "on_demand_cap")).toMatchObject({
      valueText: "0",
    });
  });

  test("412 is an account shape: partial with a capability failure; 401 is definitive", async () => {
    const team = createGrokConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({ [billingUrl]: () => json({}, 412) }).fetch,
    });
    const result = await team.collect(credentialFromAuthFile(authFile), identity);
    expect(result.failures[0]).toMatchObject({
      category: "permission_denied",
      class: "capability",
    });
    expect(result.metrics[0]).toMatchObject({ availability: "not_authorized", valueText: null });
    const bad = createGrokConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({ [billingUrl]: () => json({}, 401) }).fetch,
    });
    expect(await rejection(bad.collect(credentialFromAuthFile(authFile), identity))).toMatchObject({
      category: "authentication_required",
    });
  });

  test("refresh rotates with the stored client id; rejections are definitive; no refresh token means not refreshable", async () => {
    const http = fakeFetch({
      [tokenUrl]: () =>
        json({
          access_token: jwt({ sub: "user_synthetic", exp: 1_700_007_200 }),
          refresh_token: "refresh-2",
        }),
    });
    const connector = createGrokConnector({ runner: new FakeRunner(), fetch: http.fetch });
    const refreshed = await connector.refresh(credentialFromAuthFile(authFile));
    expect(refreshed).toMatchObject({
      status: "refreshed",
      credential: {
        expiresAt: 1_700_007_200_000,
        secret: { refreshToken: "refresh-2", clientId: "client-synthetic" },
      },
    });
    const rejected = createGrokConnector({
      runner: new FakeRunner(),
      fetch: fakeFetch({ [tokenUrl]: () => json({ error: "invalid_grant" }, 400) }).fetch,
    });
    expect(await rejected.refresh(credentialFromAuthFile(authFile))).toMatchObject({
      status: "rejected",
    });
    const noRefresh = {
      secret: { accessToken: token, refreshToken: null, idToken: null, clientId: "c" },
      expiresAt: null,
    };
    expect(await connector.refresh(noRefresh)).toEqual({ status: "not_refreshable" });
  });
});
