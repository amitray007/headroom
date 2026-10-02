/* eslint-disable no-await-in-loop -- the steps of a test run in order */
import { describe, expect, test } from "bun:test";

import type { NotificationEvent } from "@headroom/core/contracts";

import { testContext } from "../test-helpers.ts";
import { maxSendsPerPass, retryDelayMs } from "./dispatcher.ts";
import type { Fetch } from "./http.ts";
import { bodyText, syntheticEvent } from "./fixtures.ts";

const token = "123456:SYNTHETIC-token-value-0123456789abcdef";
const minute = 60_000;
const t0 = 1_790_000_000_000;

function setup(options: { events?: NotificationEvent[]; env?: Record<string, string> } = {}) {
  const sent: { url: string; body: string }[] = [];
  let status = 200;
  let respondBody: unknown = { ok: true, result: {} };
  const fetchFn: Fetch = async (url, init) => {
    sent.push({ url, body: bodyText(init) });
    return new Response(JSON.stringify(respondBody), { status });
  };
  let events = options.events ?? [syntheticEvent()];
  const ctx = testContext(options.env ?? {}, { fetch: fetchFn, derive: () => events });
  const connection = ctx.connections.create({
    provider: "claude",
    identity: {
      providerAccountId: "acct-1",
      workspaceId: null,
      label: "owner@example.com (Max)",
      assurance: "strong",
    },
    scope: "individual",
    authMethod: "import",
    interface: "private",
    connectorVersion: "fake-1",
  });
  const channel = ctx.channels.create(
    "telegram",
    { botToken: token, chatId: "-100" },
    { includeIdentity: false, label: "@synthetic_bot" },
  );
  return {
    ctx,
    channel,
    connection,
    sent,
    setStatus: (next: number, body: unknown = { ok: false }) => {
      status = next;
      respondBody = body;
    },
    setEvents: (next: NotificationEvent[]) => {
      events = next;
    },
  };
}

describe("NotificationDispatcher", () => {
  test("sends once and dedupes on the next pass", async () => {
    const { ctx, channel, sent } = setup();
    expect(await ctx.dispatcher.dispatch(t0)).toEqual({ sent: 1, delivered: 1, failed: 0 });
    expect(await ctx.dispatcher.dispatch(t0 + 10 * minute)).toEqual({
      sent: 0,
      delivered: 0,
      failed: 0,
    });
    expect(sent).toHaveLength(1);
    expect(ctx.deliveries.get(channel.id, syntheticEvent().id)?.status).toBe("delivered");
  });

  test("does nothing without an enabled channel", async () => {
    const { ctx, channel, sent } = setup();
    ctx.channels.update(channel.id, { enabled: false });
    expect(await ctx.dispatcher.dispatch(t0)).toEqual({ sent: 0, delivered: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  test("retries on 1, 5, 15, 60 minute backoff, then gives up after the fifth failure", async () => {
    const { ctx, channel, sent, setStatus } = setup();
    setStatus(500);
    const id = syntheticEvent().id;
    let at = t0;
    await ctx.dispatcher.dispatch(at);
    expect(ctx.deliveries.get(channel.id, id)).toMatchObject({
      status: "retrying",
      attempts: 1,
      failure: "server_error",
    });
    // Too early: no send.
    await ctx.dispatcher.dispatch(at + minute - 1);
    expect(sent).toHaveLength(1);
    for (const [index, wait] of [1, 5, 15, 60].entries()) {
      at += wait * minute;
      await ctx.dispatcher.dispatch(at);
      const row = ctx.deliveries.get(channel.id, id);
      expect(row?.attempts).toBe(index + 2);
      expect(row?.status).toBe(index === 3 ? "failed" : "retrying");
    }
    expect(sent).toHaveLength(5);
    expect(ctx.deliveries.get(channel.id, id)?.nextAttemptAt).toBeNull();
    await ctx.dispatcher.dispatch(at + 24 * 60 * minute);
    expect(sent).toHaveLength(5);
  });

  test("a retry that succeeds is delivered with the attempt count", async () => {
    const { ctx, channel, setStatus } = setup();
    setStatus(500);
    await ctx.dispatcher.dispatch(t0);
    setStatus(200, { ok: true, result: {} });
    await ctx.dispatcher.dispatch(t0 + minute);
    expect(ctx.deliveries.get(channel.id, syntheticEvent().id)).toMatchObject({
      status: "delivered",
      attempts: 2,
      failure: null,
    });
  });

  test("Telegram retry_after wins over a shorter backoff", () => {
    expect(retryDelayMs(1, { ok: false, retryAfterSeconds: 300 })).toBe(300_000);
    expect(retryDelayMs(1, { ok: false, retryAfterSeconds: 5 })).toBe(minute);
    expect(retryDelayMs(4, { ok: false })).toBe(60 * minute);
  });

  test("an event that is no longer derived is not retried", async () => {
    const { ctx, sent, setStatus, setEvents } = setup();
    setStatus(500);
    await ctx.dispatcher.dispatch(t0);
    setEvents([]);
    await ctx.dispatcher.dispatch(t0 + 2 * minute);
    expect(sent).toHaveLength(1);
  });

  test("identity reaches the message only when the channel includes it", async () => {
    const { ctx, channel, connection, sent, setEvents } = setup();
    const event = (id: string) =>
      syntheticEvent({ id, connection: { id: connection.id, name: "Personal", plan: null } });
    setEvents([event("x:1")]);
    await ctx.dispatcher.dispatch(t0);
    expect(JSON.parse(sent[0]?.body ?? "{}").text).not.toContain("owner@example.com");
    ctx.channels.update(channel.id, { includeIdentity: true });
    setEvents([event("x:2")]);
    await ctx.dispatcher.dispatch(t0 + minute);
    expect(JSON.parse(sent[1]?.body ?? "{}").text).toContain("owner@example.com");
  });

  test("adds the dashboard link only when a public URL is set", async () => {
    const without = setup();
    await without.ctx.dispatcher.dispatch(t0);
    expect(without.sent[0]?.body).not.toContain("Open Headroom");
    const withUrl = setup({ env: { HEADROOM_PUBLIC_URL: "https://headroom.example" } });
    await withUrl.ctx.dispatcher.dispatch(t0);
    expect(withUrl.sent[0]?.body).toContain("Open Headroom");
  });

  test("sends at most 20 per pass and the rest on the next pass", async () => {
    const events = Array.from({ length: 25 }, (_, i) => syntheticEvent({ id: `e:${i}` }));
    const { ctx, sent } = setup({ events });
    expect((await ctx.dispatcher.dispatch(t0)).sent).toBe(maxSendsPerPass);
    expect((await ctx.dispatcher.dispatch(t0 + minute)).sent).toBe(5);
    expect(sent).toHaveLength(25);
  });

  test("drops an invalid event instead of sending it", async () => {
    const bad = { ...syntheticEvent(), title: "" } as NotificationEvent;
    const { ctx, sent } = setup({ events: [bad] });
    await ctx.dispatcher.dispatch(t0);
    expect(sent).toHaveLength(0);
  });

  test("prunes records older than 60 days", async () => {
    const { ctx, channel } = setup();
    ctx.deliveries.recordAttempt({
      channelId: channel.id,
      eventId: "old",
      kind: "running_low",
      status: "delivered",
      attempts: 1,
      failure: null,
      at: new Date(t0 - 61 * 24 * 60 * minute),
      nextAttemptAt: null,
    });
    await ctx.dispatcher.dispatch(t0);
    expect(ctx.deliveries.get(channel.id, "old")).toBeNull();
  });
});
