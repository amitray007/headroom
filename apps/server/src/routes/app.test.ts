import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { z } from "zod";

import { credentialFixture, FakeConnector, okCollect } from "@headroom/core/testing";
import { appFeedSchema, appWhoamiSchema } from "@headroom/view-model/app-feed";
import { deriveNotifications } from "@headroom/view-model/notifications";

import { createApp } from "../app.ts";
import { overviewConnections } from "../overview-model.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

const initialTime = Date.UTC(2026, 9, 29, 15);
const tokenSchema = z.object({ key: z.string() });

async function fixture() {
  let now = initialTime;
  let outbound = 0;
  const connector = new FakeConnector("claude");
  const ctx = testContext(
    { HEADROOM_ENABLED_PROVIDERS: "claude", HEADROOM_PUBLIC_URL: "https://headroom.example" },
    {
      now: () => new Date(now),
      connectors: [connector],
      fetch: () => {
        outbound += 1;
        throw new Error("Feed must not fetch");
      },
    },
  );
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const created = await app.request(
    url(ctx, "/api/tokens"),
    jsonPost(ctx, { name: "Test Mac" }, { cookie }),
  );
  const token = tokenSchema.parse(await created.json());
  const headers = { authorization: `Bearer ${token.key}` };
  const row = ctx.connections.create({
    provider: "claude",
    scope: "individual",
    authMethod: "import",
    interface: "private",
    connectorVersion: "fake-1",
    identity: {
      providerAccountId: "forbidden-account-identity",
      workspaceId: "forbidden-workspace-identity",
      label: "Synthetic (Pro)",
      assurance: "strong",
    },
  });
  ctx.credentials.put(row.id, credentialFixture("forbidden-access-token"));
  const collected = okCollect("95");
  connector.collectQueue.push({
    ...collected,
    observedAt: now,
    metrics: collected.metrics.map((metric) =>
      Object.assign({}, metric, {
        providerMetricKey: "seven_day",
        scope: "window:604800s",
        resetsAt: now + 2 * 3_600_000,
      }),
    ),
  });
  await ctx.collection.run(row.id, "test");
  ctx.wallet.setCost(row.id, {
    kind: "paid",
    price: { minor: 2000, currency: "USD" },
    cycle: "monthly",
    renewsOn: null,
  });
  const get = (query = "", extra: Record<string, string> = {}) =>
    app.request(url(ctx, `/api/app/v1/feed${query}`), { headers: { ...headers, ...extra } });
  return {
    ctx,
    app,
    cookie,
    headers,
    row,
    connector,
    get,
    advance: () => {
      now += 1000;
    },
    outbound: () => outbound,
  };
}

describe("token app feed", () => {
  test("token gets validated data, whoami uses its schema, and a read calls no provider or exchange service", async () => {
    const h = await fixture();
    try {
      const calls = [...h.connector.calls];
      const response = await h.get("?tz=330");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      const feed = appFeedSchema.parse(JSON.parse(body));
      expect(feed.accounts[0]?.id).toBe(h.row.id);
      expect(feed.accounts[0]?.limits[0]?.percentLeft).toBe(5);
      expect(feed.dashboardUrl).toBe("https://headroom.example");
      expect(feed.summary.monthlyPlanTotal).toEqual({ minor: 2000, currency: "USD" });
      const notices = deriveNotifications(
        overviewConnections(h.ctx, initialTime),
        { ...h.ctx.settings.get(), timeStyle: "exact", tzOffsetMinutes: 330 },
        initialTime,
      );
      expect(feed.notices).toEqual(
        notices.map((event) =>
          Object.assign({}, event, { links: { dashboard: "https://headroom.example" } }),
        ),
      );
      expect(feed.notices[0]?.message).toContain("at 22:30");
      for (const forbidden of [
        "forbidden-account-identity",
        "forbidden-workspace-identity",
        "forbidden-access-token",
        "providerAccountId",
        "workspaceId",
        "credential",
        "rawResponse",
        "latestRun",
      ])
        expect(body).not.toContain(forbidden);
      expect(h.connector.calls).toEqual(calls);
      expect(h.outbound()).toBe(0);
      const whoami = await h.app.request(url(h.ctx, "/api/app/v1/whoami"), { headers: h.headers });
      expect(appWhoamiSchema.parse(await whoami.json()).tokenName).toBe("Test Mac");
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("ETag hashes the exact body, stays stable across requests, supports validators and changes with content", async () => {
    const h = await fixture();
    try {
      const first = await h.get();
      const body = await first.text();
      const etag = first.headers.get("etag")!;
      expect(etag).toBe(`"${createHash("sha256").update(body).digest("hex")}"`);
      h.advance();
      const same = await h.get();
      expect(await same.text()).toBe(body);
      expect(same.headers.get("etag")).toBe(etag);
      await Promise.all(
        [etag, `"unrelated", ${etag}`, `W/${etag}`, "*"].map(async (validator) => {
          const unchanged = await h.get("", { "if-none-match": validator });
          expect(unchanged.status).toBe(304);
          expect(await unchanged.text()).toBe("");
          expect(unchanged.headers.get("etag")).toBe(etag);
          expect(unchanged.headers.get("cache-control")).toBe("no-store");
        }),
      );
      const otherZone = await h.get("?tz=-720", { "if-none-match": etag });
      expect(otherZone.status).toBe(200);
      expect(otherZone.headers.get("etag")).not.toBe(etag);
      h.ctx.connections.setDisplayName(h.row.id, "Work");
      const changed = await h.get("", { "if-none-match": etag });
      expect(changed.status).toBe(200);
      expect(changed.headers.get("etag")).not.toBe(etag);
      const head = await h.app.request(url(h.ctx, "/api/app/v1/feed"), {
        method: "HEAD",
        headers: h.headers,
      });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("timezone syntax and range match history, and invalid query cannot bypass authentication", async () => {
    const h = await fixture();
    try {
      await Promise.all(
        ["", "1.5", "1e2", "NaN", "-721", "841", "10000", " 60", "+60"].map(async (value) => {
          const invalid = await h.get(`?tz=${encodeURIComponent(value)}`);
          expect(invalid.status).toBe(400);
          expect(await invalid.json()).toEqual({ error: "invalid_tz" });
          expect(invalid.headers.get("cache-control")).toBe("no-store");
        }),
      );
      await Promise.all(
        ["-720", "0", "330", "840"].map(async (value) => {
          expect((await h.get(`?tz=${value}`)).status).toBe(200);
        }),
      );
      await Promise.all(
        [{ cookie: h.cookie }, {}].map(async (headers) => {
          const denied = await h.app.request(url(h.ctx, "/api/app/v1/feed?tz=bad"), { headers });
          expect(denied.status).toBe(401);
          expect(await denied.json()).toEqual({ error: "invalid_token" });
        }),
      );
      const mutation = await h.app.request(url(h.ctx, "/api/app/v1/feed"), {
        method: "POST",
        headers: h.headers,
      });
      expect(mutation.status).toBe(405);
      expect(mutation.headers.get("allow")).toBe("GET, HEAD");
    } finally {
      h.ctx.sqlite.close();
    }
  });
});
