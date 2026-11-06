import { expect, test } from "bun:test";
import { type StoredCredential, type MetricObservation } from "@headroom/core";
import { createZaiConnector } from "./index.ts";
import customer from "./fixtures/customer.json";
import quota from "./fixtures/success.json";
import resets from "./fixtures/resets.json";
import partial from "./fixtures/resets-partial.json";
const now = 1800000000000;
const credential: StoredCredential = {
  secret: {
    kind: "oauth",
    accessToken: "synthetic-business-token",
    oauthAccessToken: "synthetic-oauth-token",
    zcodeToken: "synthetic-zcode-token",
    accountId: "synthetic-customer-alpha",
    label: "Sample",
  },
  expiresAt: now + 3600000,
};
const identity = {
  providerAccountId: "zai:synthetic-customer-alpha",
  workspaceId: null,
  label: "Sample",
  assurance: "strong" as const,
};
function fixture(body: unknown = resets, status = 200) {
  const calls: {
    url: string;
    method: string | undefined;
    headers: Headers;
    redirect: RequestInit["redirect"];
  }[] = [];
  const client = createZaiConnector({
    now: () => now,
    fetch: (input, request) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({
        url,
        method: request?.method,
        headers: new Headers(request?.headers),
        redirect: request?.redirect,
      });
      const payload = url.endsWith("/getCustomerInfo")
        ? customer
        : url.endsWith("/quota/limit")
          ? quota
          : body;
      return Promise.resolve(
        Response.json(payload, {
          status: url.endsWith("/reset/status") ? status : 200,
          headers: { "retry-after": "120" },
        }),
      );
    },
  });
  return { client, calls };
}
function metric(metrics: readonly MetricObservation[], key: string) {
  return metrics.find((m) => m.providerMetricKey === key);
}
test("reads already-granted reset cards using the same approval’s two tokens and no mutation", async () => {
  const f = fixture();
  const result = await f.client.collect(credential, identity);
  const request = f.calls.find((call) => call.url.endsWith("/reset/status"));
  expect(request?.url).toBe("https://zcode.z.ai/api/v1/coding-plan/reset/status");
  expect(request?.method).toBe("GET");
  expect(request?.redirect).toBe("error");
  expect(request?.headers.get("authorization")).toBe("Bearer synthetic-zcode-token");
  expect(request?.headers.get("x-bigmodel-authorization")).toBe("synthetic-business-token");
  expect(request?.headers.get("bigmodel-target-type")).toBe("PERSONAL");
  expect(metric(result.metrics, "reset_credits.available_count")).toMatchObject({
    kind: "reset_inventory",
    valueText: "3",
    unit: "resets",
    availability: "available",
    interface: "private",
  });
  expect(metric(result.metrics, "reset_credits.five_hour.available_count")?.valueText).toBe("2");
  expect(metric(result.metrics, "reset_credits.weekly.available_count")?.valueText).toBe("1");
  expect(result.resetCredits).toHaveLength(3);
  expect(new Set(result.resetCredits?.map((c) => c.providerCreditId)).size).toBe(3);
  expect(
    result.resetCredits?.every(
      (c) => c.expiresAt !== undefined && c.expiresAt !== null && c.expiresAt > now && c.usable,
    ),
  ).toBe(true);
  expect(result.failures).toEqual([]);
  expect(f.calls.every((call) => call.method === "GET")).toBe(true);
});
test("empty inventories are known zero; expired cards and shuffled rows do not change usable identities", async () => {
  const f = fixture({
    code: 0,
    data: { available_five_hour_resets: [], available_week_resets: [] },
  });
  const empty = await f.client.collect(credential, identity);
  expect(metric(empty.metrics, "reset_credits.available_count")?.valueText).toBe("0");
  expect(empty.resetCredits).toEqual([]);
  const ordered = await fixture().client.collect(credential, identity);
  const shuffled = await fixture({
    ...resets,
    data: {
      ...resets.data,
      available_five_hour_resets: resets.data.available_five_hour_resets.toReversed(),
    },
  }).client.collect(credential, identity);
  expect(shuffled.resetCredits).toEqual(ordered.resetCredits);
});
test("one malformed list leaves its count unknown while preserving other reset cards and coding quota", async () => {
  const result = await fixture(partial).client.collect(credential, identity);
  expect(metric(result.metrics, "reset_credits.five_hour.available_count")?.valueText).toBe("1");
  expect(metric(result.metrics, "reset_credits.weekly.available_count")).toMatchObject({
    valueText: null,
    availability: "unknown",
  });
  expect(metric(result.metrics, "reset_credits.available_count")?.valueText).toBeNull();
  expect(metric(result.metrics, "quota.18000s")?.valueText).toBe("25");
  expect(result.resetCredits).toHaveLength(1);
  expect(result.failures).toContainEqual(expect.objectContaining({ category: "invalid_response" }));
});
test.each([{}, { code: 0, data: {} }, { code: 0, data: { available_five_hour_resets: null } }])(
  "missing reset inventory is unknown, never zero (%j)",
  async (body) => {
    const result = await fixture(body).client.collect(credential, identity);
    expect(metric(result.metrics, "reset_credits.available_count")).toMatchObject({
      valueText: null,
      availability: "unknown",
    });
    expect(metric(result.metrics, "quota.604800s")?.valueText).toBe("80");
  },
);
test.each([401, 403, 429, 503])(
  "reset HTTP %s cannot disconnect a working quota session",
  async (status) => {
    const result = await fixture({ msg: "synthetic-zcode-token" }, status).client.collect(
      credential,
      identity,
    );
    expect(metric(result.metrics, "quota.18000s")?.valueText).toBe("25");
    expect(metric(result.metrics, "reset_credits.available_count")?.valueText).toBeNull();
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.every((f) => f.class !== "definitive")).toBe(true);
    expect(JSON.stringify(result.failures)).not.toContain("synthetic-zcode-token");
  },
);
test("an older session without the ZCode token asks for browser sign-in without a guessed request", async () => {
  const f = fixture();
  const { zcodeToken: _token, ...oldSecret } = credential.secret;
  const result = await f.client.collect({ ...credential, secret: oldSecret }, identity);
  expect(f.calls.some((c) => c.url.includes("/reset/"))).toBe(false);
  expect(metric(result.metrics, "reset_credits.available_count")?.valueText).toBeNull();
  expect(result.failures).toContainEqual(
    expect.objectContaining({ category: "unsupported_metric" }),
  );
});
test("legacy keys explicitly lack reset-card authorization", async () => {
  const f = fixture();
  const result = await f.client.collect(
    { secret: { apiKey: "synthetic-legacy-key" }, expiresAt: null },
    identity,
  );
  expect(f.calls).toHaveLength(1);
  expect(metric(result.metrics, "reset_credits.available_count")).toMatchObject({
    valueText: null,
    availability: "unsupported",
  });
});
