import { describe, expect, test } from "bun:test";
import { type FetchLike, type StoredCredential, providerSchema } from "@headroom/core";
import success from "./fixtures/success.json";
import partial from "./fixtures/partial.json";
import drift from "./fixtures/drift.json";
import { createZaiConnector } from "./index.ts";

const now = 1_800_000_000_000;
const credential: StoredCredential = { secret: { apiKey: "synthetic-key-alpha" }, expiresAt: null };
const identity = {
  providerAccountId: "synthetic-key-identity",
  workspaceId: null,
  label: "Z.ai",
  assurance: "weak" as const,
};
function connector(body: unknown = success, status = 200) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: FetchLike = (url, init) => {
    requests.push({ url: url instanceof Request ? url.url : String(url), init });
    return Promise.resolve(Response.json(body, { status, headers: { "retry-after": "120" } }));
  };
  return { client: createZaiConnector({ fetch, now: () => now }), requests };
}
function bodyWith(limits: unknown[]) {
  return { success: true, code: 200, data: { limits } };
}

describe("Z.ai Coding Plan", () => {
  test("is a supported provider", () => {
    expect(providerSchema.safeParse("zai").success).toBe(true);
  });
  test("new connections reject pasted API keys and use browser sign-in", async () => {
    const { client } = connector();
    expect(client.supportedMethods).toEqual(["approval_poll"]);
    expect(
      await client.beginConnect({
        attemptId: "synthetic-attempt",
        method: "api_key",
        expiresAt: now + 600000,
      }),
    ).toMatchObject({ status: "error" });
    expect(
      await client.submitInput(null, {
        kind: "api_key",
        values: { apiKey: "synthetic-key-alpha" },
      }),
    ).toMatchObject({ status: "error" });
  });
  test("reads only the fixed quota endpoint with the official plugin header and no redirects", async () => {
    const { client, requests } = connector();
    await client.collect(credential, identity);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.z.ai/api/monitor/usage/quota/limit");
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "synthetic-key-alpha",
    );
    expect(requests[0]?.init?.redirect).toBe("error");
    expect(requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });
  test("preserves independent credit windows, MCP counts and real reset timestamps", async () => {
    const { client } = connector();
    const result = await client.collect(credential, identity);
    expect(result.observedAt).toBe(now);
    expect(result.failures).toEqual([]);
    expect(result.metrics).toContainEqual(
      expect.objectContaining({
        providerMetricKey: "quota.18000s",
        kind: "quota_percentage",
        valueText: "25",
        scope: "window:18000s",
        resetsAt: 1800003600000,
        interface: "private",
      }),
    );
    expect(result.metrics).toContainEqual(
      expect.objectContaining({ providerMetricKey: "quota.604800s", valueText: "80" }),
    );
    expect(result.metrics).toContainEqual(
      expect.objectContaining({
        providerMetricKey: "mcp.monthly",
        valueText: "15",
        scope: "window:monthly",
        resetsAt: 1801728000000,
      }),
    );
    expect(result.metrics).toContainEqual(
      expect.objectContaining({
        providerMetricKey: "mcp.monthly.used",
        kind: "absolute_quota",
        unit: "requests",
        valueText: "150",
      }),
    );
    expect(result.metrics.every((metric) => metric.interface === "private")).toBe(true);
  });
  test("legacy zero remains known while a malformed weekly value stays unknown", async () => {
    const { client } = connector(partial);
    const result = await client.collect(credential, identity);
    expect(result.metrics).toContainEqual(
      expect.objectContaining({
        providerMetricKey: "quota.18000s",
        valueText: "0",
        availability: "available",
      }),
    );
    expect(result.metrics).toContainEqual(
      expect.objectContaining({
        providerMetricKey: "quota.604800s",
        valueText: null,
        availability: "unknown",
      }),
    );
    expect(result.metrics.some((metric) => metric.providerMetricKey.startsWith("mcp."))).toBe(
      false,
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({ category: "invalid_response" }),
    );
  });
  test("missing percentages are never derived into a fake zero, and unknown types never become coding windows", async () => {
    const { client } = connector(
      bodyWith([
        { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 12000, currentValue: 0 },
        { type: "UNKNOWN_POOL", unit: 6, number: 1, percentage: 20 },
      ]),
    );
    const result = await client.collect(credential, identity);
    expect(result.metrics.every((metric) => metric.valueText === null)).toBe(true);
    expect(result.failures.length).toBeGreaterThan(0);
  });
  test("empty limits keep required windows unknown", async () => {
    const { client } = connector(bodyWith([]));
    const result = await client.collect(credential, identity);
    expect(
      result.metrics.filter((metric) => metric.providerMetricKey.startsWith("quota.")),
    ).toHaveLength(2);
    expect(
      result.metrics
        .filter((metric) => metric.kind === "reset_inventory")
        .every((metric) => metric.availability === "unsupported"),
    ).toBe(true);
    expect(
      result.metrics
        .filter((metric) => metric.providerMetricKey.startsWith("quota."))
        .every((metric) => metric.availability === "unknown" && metric.valueText === null),
    ).toBe(true);
  });
  test("duplicate windows do not silently replace or average usage", async () => {
    const bucket = { type: "CREDIT_LIMIT", unit: 3, number: 5, percentage: 20 };
    const { client } = connector(bodyWith([bucket, { ...bucket, percentage: 80 }]));
    const result = await client.collect(credential, identity);
    expect(
      result.metrics.find((metric) => metric.providerMetricKey === "quota.18000s")?.valueText,
    ).toBeNull();
    expect(result.failures).toContainEqual(
      expect.objectContaining({ category: "invalid_response" }),
    );
  });
  test("bad reset or optional counts do not discard a good percentage", async () => {
    const { client } = connector(
      bodyWith([
        {
          type: "TIME_LIMIT",
          unit: 5,
          number: 1,
          percentage: 12,
          currentValue: null,
          usage: -1,
          nextResetTime: "tomorrow",
        },
      ]),
    );
    const result = await client.collect(credential, identity);
    expect(result.metrics).toContainEqual(
      expect.objectContaining({
        providerMetricKey: "mcp.monthly",
        valueText: "12",
        resetsAt: null,
      }),
    );
    expect(result.metrics).toContainEqual(
      expect.objectContaining({ providerMetricKey: "mcp.monthly.used", valueText: null }),
    );
  });
  test("identity validates the envelope and isolates distinct keys without exposing the secret", async () => {
    const { client } = connector();
    const first = await client.identity(credential);
    const second = await client.identity({
      secret: { apiKey: "synthetic-key-beta" },
      expiresAt: null,
    });
    expect(first.assurance).toBe("weak");
    expect(first.providerAccountId).not.toBe(second.providerAccountId);
    expect(JSON.stringify(first)).not.toContain("synthetic-key-alpha");
    expect(await client.identity(credential)).toEqual(first);
  });
  test.each([drift, { success: false, code: 500, msg: "synthetic-key-alpha" }])(
    "schema drift and unsuccessful 200 envelopes are safe capability errors",
    async (body) => {
      const { client } = connector(body);
      try {
        await client.identity(credential);
        throw new Error("expected rejection");
      } catch (error) {
        expect(client.classify(error)).toMatchObject({
          category: "invalid_response",
          class: "capability",
        });
        expect(JSON.stringify(client.classify(error))).not.toContain("synthetic-key-alpha");
      }
    },
  );
  test.each([
    [401, "authentication_required"],
    [403, "permission_denied"],
    [429, "rate_limited"],
    [503, "provider_unavailable"],
    [302, "invalid_response"],
  ] as const)("classifies HTTP %s without response text", async (status, category) => {
    const { client } = connector({ msg: "synthetic-key-alpha" }, status);
    try {
      await client.collect(credential, identity);
      throw new Error("expected rejection");
    } catch (error) {
      const failure = client.classify(error);
      expect(failure.category).toBe(category);
      expect(failure.message).not.toContain("synthetic-key-alpha");
      if (status === 429) expect(failure.retryAfterMs).toBe(120000);
    }
  });
  test("transport exceptions are sanitized and never revoke a key", async () => {
    const client = createZaiConnector({
      fetch: () => Promise.reject(new Error("synthetic-key-alpha")),
    });
    try {
      await client.collect(credential, identity);
      throw new Error("expected rejection");
    } catch (error) {
      expect(client.classify(error)).toMatchObject({
        category: "provider_unavailable",
        class: "transient",
      });
      expect(client.classify(error).message).not.toContain("synthetic-key-alpha");
    }
  });
  test("has no refresh or remote account actions", async () => {
    const { client } = connector();
    expect(await client.refresh(credential)).toEqual({ status: "not_refreshable" });
    expect(await client.disconnect(credential)).toBe("local_only");
    expect(client.supportedActions ?? []).toEqual([]);
  });
});
