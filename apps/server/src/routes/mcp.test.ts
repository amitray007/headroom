import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { credentialFixture, FakeConnector, okCollect } from "@headroom/core/testing";

import { createApp } from "../app.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

const hour = 3_600_000;
const day = 24 * hour;
const week = 7 * day;
const firstReset = Date.UTC(2026, 9, 1);
const tokenSchema = z.object({ key: z.string() });
const replySchema = z.object({
  result: z.object({
    tools: z
      .array(z.object({ name: z.string(), annotations: z.record(z.string(), z.unknown()) }))
      .optional(),
    content: z.array(z.object({ type: z.string(), text: z.string() })).optional(),
    structuredContent: z.unknown().optional(),
  }),
});

/** The 2025 stateless fallback answers over SSE; the 2026 path answers JSON. */
async function replyOf(response: Response) {
  const body = await response.text();
  const data = body.split("\n").find((line) => line.startsWith("data: "));
  return replySchema.parse(JSON.parse(data === undefined ? body : data.slice(6)));
}

async function fixture() {
  let now = firstReset - week;
  const claude = new FakeConnector("claude");
  const ctx = testContext(
    { HEADROOM_ENABLED_PROVIDERS: "claude,codex" },
    { now: () => new Date(now), connectors: [claude, new FakeConnector("codex")] },
  );
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const created = await app.request(
    url(ctx, "/api/tokens"),
    jsonPost(ctx, { name: "Agent" }, { cookie }),
  );
  const token = tokenSchema.parse(await created.json());
  const create = (provider: "claude" | "codex", label: string) =>
    ctx.connections.create({
      provider,
      scope: "individual",
      authMethod: "import",
      interface: "private",
      connectorVersion: "fake-1",
      identity: { providerAccountId: label, workspaceId: null, label, assurance: "strong" },
    });
  const row = create("claude", "Synthetic (Max)");
  create("codex", "Spare (Pro)");
  ctx.credentials.put(row.id, credentialFixture());
  ctx.wallet.setCost(row.id, {
    kind: "paid",
    price: { minor: 2000, currency: "USD" },
    cycle: "monthly",
    renewsOn: null,
  });
  // Weekly windows ending at firstReset + k weeks, one reading at the start and one at the peak.
  const read = async (at: number, used: number, resetsAt: number) => {
    now = at;
    const collected = okCollect(String(used));
    claude.collectQueue.push({
      ...collected,
      observedAt: at,
      metrics: collected.metrics.map((metric) =>
        Object.assign({}, metric, {
          providerMetricKey: "seven_day",
          scope: "window:604800s",
          resetsAt,
        }),
      ),
    });
    await ctx.collection.run(row.id, "test");
  };
  const peaks = [10, 64, 82, 100, 71];
  const schedule = peaks.flatMap((peak, k) => {
    const end = firstReset + k * week;
    return [
      { at: end - week + hour, used: 10, resetsAt: end },
      { at: end - hour, used: peak, resetsAt: end },
    ];
  });
  schedule.push({ at: firstReset + 4 * week + 2 * day, used: 20, resetsAt: firstReset + 5 * week });
  // Readings must land in time order, so chain them instead of running them together.
  await schedule.reduce(
    (done, step) => done.then(() => read(step.at, step.used, step.resetsAt)),
    Promise.resolve(),
  );
  const headers = { authorization: `Bearer ${token.key}`, "content-type": "application/json" };
  const rpc = (body: unknown, extra: Record<string, string> = {}) =>
    app.request(url(ctx, "/api/mcp"), {
      method: "POST",
      headers: { ...headers, accept: "application/json, text/event-stream", ...extra },
      body: JSON.stringify(body),
    });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    });
    return (await replyOf(response)).result;
  };
  return { ctx, app, cookie, headers, rpc, call };
}

describe("POST /api/mcp", () => {
  test("rejects a missing, bad or session-only credential", async () => {
    const h = await fixture();
    try {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      const post = (headers: Record<string, string>) =>
        h.app.request(url(h.ctx, "/api/mcp"), { method: "POST", headers, body });
      const json = { "content-type": "application/json" };
      expect((await post(json)).status).toBe(401);
      expect((await post({ ...json, authorization: "Bearer wrong" })).status).toBe(401);
      const session = await post({ ...json, cookie: h.cookie });
      expect(session.status).toBe(401);
      expect(session.headers.get("cache-control")).toBe("no-store");
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("shares the failed-token limit with the app feed", async () => {
    const h = await fixture();
    try {
      const bad = { authorization: "Bearer wrong" };
      const feeds = await Promise.all(
        Array.from({ length: 10 }, async () =>
          h.app.request(url(h.ctx, "/api/app/v1/feed"), { headers: bad }),
        ),
      );
      expect(feeds.map((feed) => feed.status)).toEqual(Array.from({ length: 10 }, () => 401));
      const response = await h.app.request(url(h.ctx, "/api/mcp"), {
        method: "POST",
        headers: { ...bad, "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(429);
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("answers anything but POST with 405 and Allow: POST", async () => {
    const h = await fixture();
    try {
      const response = await h.app.request(url(h.ctx, "/api/mcp"), { headers: h.headers });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("lists exactly the read-only status and history tools", async () => {
    const h = await fixture();
    try {
      const response = await h.rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(response.status).toBe(200);
      const tools = (await replyOf(response)).result.tools ?? [];
      expect(tools.map((tool) => tool.name).toSorted()).toEqual(["history", "status"]);
      for (const tool of tools) {
        expect(tool.annotations).toMatchObject({
          readOnlyHint: true,
          openWorldHint: false,
          idempotentHint: true,
        });
      }
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("status returns compact text with one block per account", async () => {
    const h = await fixture();
    try {
      const result = await h.call("status");
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([
        {
          type: "text",
          text: [
            "codex · Personal (Pro) · private API",
            "claude · Personal (Max) · private API",
            "  Weekly: 80% left, resets in 5 days",
            "  banked: 1 Reset Grant",
            "plans: $20/month",
          ].join("\n"),
        },
      ]);
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("status filters by provider", async () => {
    const h = await fixture();
    try {
      const result = await h.call("status", { provider: "codex" });
      expect(result.content?.[0]?.text).toBe("codex · Personal (Pro) · private API");
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("history reports closed windows, the hit and the fit", async () => {
    const h = await fixture();
    try {
      const result = await h.call("history", { days: 30 });
      expect(result.content?.[0]?.text).toBe(
        [
          "last 30 days, history covers 30 days",
          "marks: ! hit the limit",
          "claude · Personal (Max) weekly: 4 windows, avg peak 79%, max 100%, hit limit 1x (1 h locked), fit: fits, ~$4/month unused",
          "  peaks: 64 82 100! 71",
        ].join("\n"),
      );
      const other = await h.call("history", { provider: "codex" });
      expect(other.content?.[0]?.text).toBe("last 30 days, no history yet");
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("history reads the asked span and refuses any other", async () => {
    const h = await fixture();
    try {
      const lastWeek = await h.call("history", { days: 7 });
      expect(lastWeek.content?.[0]?.text).toStartWith("last 7 days, history covers ");
      const response = await h.rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "history", arguments: { days: 14 } },
      });
      const body = await response.text();
      expect(body).not.toContain("last 14 days");
      expect(body).toMatch(/"isError":true|"error":\{/);
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("answers a 2026-07-28 request in one JSON body", async () => {
    const h = await fixture();
    try {
      const response = await h.rpc(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "status",
            arguments: { provider: "codex" },
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
              "io.modelcontextprotocol/clientInfo": { name: "modern", version: "1" },
            },
          },
        },
        { "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/call", "mcp-name": "status" },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toStartWith("application/json");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await replyOf(response)).result.content?.[0]?.text).toBe(
        "codex · Personal (Pro) · private API",
      );
    } finally {
      h.ctx.sqlite.close();
    }
  });

  test("serves a 2025-era client with no session", async () => {
    const h = await fixture();
    try {
      const init = await h.rpc(
        {
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "legacy", version: "1" },
          },
        },
        { "mcp-protocol-version": "2025-06-18" },
      );
      expect(init.status).toBe(200);
      expect(init.headers.get("mcp-session-id")).toBeNull();
      const response = await h.rpc(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "status", arguments: { provider: "codex" } },
        },
        { "mcp-protocol-version": "2025-06-18" },
      );
      expect(response.status).toBe(200);
      const text = (await replyOf(response)).result.content?.[0]?.text;
      expect(text).toBe("codex · Personal (Pro) · private API");
    } finally {
      h.ctx.sqlite.close();
    }
  });
});
