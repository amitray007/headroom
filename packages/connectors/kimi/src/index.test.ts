import { describe, expect, test } from "bun:test";

import {
  nextStepPayloadSchema,
  type FetchLike,
  type Identity,
  type StoredCredential,
} from "@headroom/core";

import { createKimiConnector } from "./index.ts";
import usage from "./fixtures/usage.json";
import legacy from "./fixtures/legacy-usage.json";
import partial from "./fixtures/partial-usage.json";
import drift from "./fixtures/schema-drift.json";

const now = 1_794_000_000_000;
const base = "https://api.kimi.ai/coding/v1";
const credential: StoredCredential = {
  secret: { apiKey: "synthetic-kimi-key", region: "global" },
  expiresAt: null,
};
const identity: Identity = {
  providerAccountId: "global:synthetic-account",
  workspaceId: null,
  label: "sample@example.com (Plus)",
  assurance: "strong",
};
const profile = {
  user_id: "synthetic-account",
  email: "sample@example.com",
  user_level_name: "Plus",
};

function transport(body: unknown = usage, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls,
    fetch: (input: Parameters<FetchLike>[0], init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(init === undefined ? { url } : { url, init });
      return Promise.resolve(
        Response.json(url.endsWith("/me") ? profile : body, {
          status,
          headers: { "retry-after": "120" },
        }),
      );
    },
  };
}

describe("Kimi Code connector", () => {
  test("new connections offer browser sign-in while old stored keys remain non-refreshable", async () => {
    const connector = createKimiConnector();
    const begin = await connector.beginConnect({
      attemptId: "synthetic",
      method: "device_code",
      expiresAt: now + 600_000,
    });
    if (begin.status !== "next_step") throw new Error("Expected region selection");
    expect(nextStepPayloadSchema.parse(begin.nextStep)).toMatchObject({
      kind: "select_account",
      label: "Account region",
      options: [{ id: "global" }, { id: "mainland-cn" }],
    });
    expect(
      await connector.submitInput(begin.privateState, {
        kind: "api_key",
        values: { apiKey: "obsolete-key" },
      }),
    ).toMatchObject({ status: "error" });
    expect(await connector.pollConnect(null)).toMatchObject({ status: "error" });
    expect(await connector.refresh(credential)).toEqual({ status: "not_refreshable" });
    expect(await connector.disconnect(credential)).toBe("local_only");
    expect(connector.supportedActions ?? []).toEqual([]);
  });

  test("reads stable identity from the selected region, independent of key rotation", async () => {
    const http = transport();
    const connector = createKimiConnector({ fetch: http.fetch });
    expect(await connector.identity(credential)).toEqual(identity);
    expect(
      await connector.identity({
        ...credential,
        secret: { apiKey: "replacement-key", region: "global" },
      }),
    ).toEqual(identity);
    const cn = await connector.identity({
      ...credential,
      secret: { apiKey: "cn-key", region: "mainland-cn" },
    });
    expect(cn.providerAccountId).toBe("mainland-cn:synthetic-account");
    expect(http.calls.map((call) => call.url)).toEqual([
      `${base}/me`,
      `${base}/me`,
      "https://api.kimi.com/coding/v1/me",
    ]);
    expect(new Headers(http.calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer synthetic-kimi-key",
    );
    expect(new Headers(http.calls[1]?.init?.headers).get("authorization")).toBe(
      "Bearer replacement-key",
    );
    expect(http.calls.every((call) => call.init?.redirect === "error")).toBe(true);
  });

  test("reads session and weekly resets while ignoring monthly fields", async () => {
    const http = transport();
    const connector = createKimiConnector({ fetch: http.fetch, now: () => now });
    const result = await connector.collect(credential, identity);
    expect(result.observedAt).toBe(now);
    expect(result.failures).toEqual([]);
    expect(
      result.metrics.map((metric) => [metric.providerMetricKey, metric.valueText, metric.scope]),
    ).toEqual([
      ["quota.five_hour", "35", "window:18000s"],
      ["quota.weekly", "62", "window:604800s"],
    ]);
    expect(result.metrics[0]).toMatchObject({
      resetsAt: Date.parse("2026-11-06T20:00:00Z"),
      availability: "available",
      interface: "private",
      unit: "percent",
    });
    expect(
      result.metrics.every(
        (metric) => metric.windowStart === null || metric.windowStart === undefined,
      ),
    ).toBe(true);
    expect(http.calls.map((call) => [call.url, call.init?.method])).toEqual([
      [`${base}/usages`, "GET"],
    ]);
    expect(
      (await connector.capabilities(credential, identity)).every(
        (capability) =>
          capability.evidenceLevel !== "validated" && capability.interface === "private",
      ),
    ).toBe(true);
  });

  test("normalizes legacy limit/remaining and used counts", async () => {
    const connector = createKimiConnector({ fetch: transport(legacy).fetch });
    const result = await connector.collect(credential, identity);
    expect(result.failures).toEqual([]);
    expect(result.metrics.map((metric) => [metric.providerMetricKey, metric.valueText])).toEqual([
      ["quota.five_hour", "35"],
      ["quota.weekly", "62"],
    ]);
  });

  test("does not invent weekly limits, monthly starts, balances or reset inventories", async () => {
    const connector = createKimiConnector({ fetch: transport(partial).fetch });
    const result = await connector.collect(credential, identity);
    expect(result.metrics.map((metric) => metric.providerMetricKey)).toEqual(["quota.five_hour"]);
    expect(result.metrics[0]?.resetsAt).toBeNull();
    expect(result.resetCredits ?? []).toEqual([]);
  });

  test("isolates schema drift and invalid resets without dropping healthy windows", async () => {
    const connector = createKimiConnector({ fetch: transport(drift).fetch });
    const result = await connector.collect(credential, identity);
    expect(result.metrics[0]).toMatchObject({ valueText: null, availability: "unknown" });
    expect(result.metrics[1]).toMatchObject({
      valueText: "62",
      availability: "available",
      resetsAt: null,
    });
    expect(result.metrics).toHaveLength(2);
    expect(result.failures).toHaveLength(2);
    expect(result.failures.every((failure) => failure.category === "invalid_response")).toBe(true);
  });

  test("invalid numeric values never become zero; explicit zero remains available", async () => {
    await Promise.all(
      ["", " ", null, true, -0.1, 1.1, "Infinity", {}, "0x0"].map(async (value) => {
        const connector = createKimiConnector({
          fetch: transport({ usages: { limit_5h: { used_ratio: value } } }).fetch,
        });
        const result = await connector.collect(credential, identity);
        expect(result.metrics[0]).toMatchObject({ valueText: null, availability: "unknown" });
        expect(result.failures[0]?.category).toBe("invalid_response");
      }),
    );
    const zero = createKimiConnector({
      fetch: transport({ usages: { limit_5h: { used_ratio: "0" } } }).fetch,
    });
    expect((await zero.collect(credential, identity)).metrics[0]).toMatchObject({
      valueText: "0",
      availability: "available",
    });
  });

  test("rejects a changed top-level shape and impossible legacy counts", async () => {
    await Promise.all(
      [null, [], {}, { usages: [] }].map(async (body) => {
        const connector = createKimiConnector({ fetch: transport(body).fetch });
        const failure = await connector
          .collect(credential, identity)
          .catch((error: unknown) => error);
        expect(failure).toMatchObject({
          category: "invalid_response",
        });
      }),
    );
    await Promise.all(
      [
        { limit: 0, remaining: 0 },
        { limit: 100, remaining: 101 },
        { limit: 100 },
        { limit: "", used: 0 },
      ].map(async (bucket) => {
        const connector = createKimiConnector({ fetch: transport({ usage: bucket }).fetch });
        const result = await connector.collect(credential, identity);
        expect(result.metrics[0]).toMatchObject({ valueText: null, availability: "unknown" });
      }),
    );
  });

  test("status failures stay sanitized and never fall back to another region", async () => {
    await Promise.all(
      (
        [
          [401, "authentication_required", "definitive"],
          [403, "permission_denied", "capability"],
          [412, "invalid_response", "capability"],
          [429, "rate_limited", "transient"],
          [503, "provider_unavailable", "transient"],
        ] as const
      ).map(async ([status, category, failureClass]) => {
        const http = transport({ secret: "synthetic-response-must-not-escape" }, status);
        const connector = createKimiConnector({ fetch: http.fetch });
        const error = await connector
          .collect(credential, identity)
          .catch((failure: unknown) => failure);
        const failure = connector.classify(error);
        expect(failure).toMatchObject({ category, class: failureClass });
        if (status === 429) expect(failure.retryAfterMs).toBe(120_000);
        expect(JSON.stringify(failure)).not.toContain("synthetic-response");
        expect(http.calls).toHaveLength(1);
      }),
    );
  });

  test("two concurrent accounts keep their credentials and responses separate", async () => {
    const connector = createKimiConnector({
      fetch: (_url, init) => {
        const key = new Headers(init?.headers).get("authorization");
        return Promise.resolve(
          Response.json({
            usages: { limit_5h: { used_ratio: key === "Bearer synthetic-kimi-key" ? 0.2 : 0.8 } },
          }),
        );
      },
    });
    const [one, two] = await Promise.all([
      connector.collect(credential, identity),
      connector.collect(
        { ...credential, secret: { apiKey: "second-key", region: "global" } },
        { ...identity, providerAccountId: "global:second-account" },
      ),
    ]);
    expect(one.metrics[0]?.valueText).toBe("20");
    expect(two.metrics[0]?.valueText).toBe("80");
  });
});
