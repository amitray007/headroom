/* eslint-disable no-await-in-loop -- the steps of a test run in order */
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { bodyText, headerMap, syntheticEvent } from "./fixtures.ts";
import type { NotificationDeliveryFailure } from "@headroom/core";

import { telegramText } from "./format.ts";
import type { Fetch } from "./http.ts";
import { telegramGetChats, telegramGetMe, telegramSend } from "./telegram.ts";
import { parseWebhookUrl, webhookMessageId, webhookSend } from "./webhook.ts";

interface Call {
  url: string;
  init: RequestInit;
}
function fake(respond: (call: Call) => Response | Promise<Response> | Error) {
  const calls: Call[] = [];
  const fetchFn: Fetch = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const out = await respond(call);
    if (out instanceof Error) throw out;
    return out;
  };
  return { calls, fetchFn };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const token = "123456:SYNTHETIC-token-value-0123456789abcdef";

describe("telegram text", () => {
  test("headline, sentence, account line, link", () => {
    const text = telegramText(
      syntheticEvent({ links: { dashboard: "https://headroom.example/" } }),
    );
    expect(text).toBe(
      [
        "<b>Claude Weekly Limit Is Running Low</b>",
        "78% used. Resets in 52 min.",
        "Claude · Personal · Max 5x",
        '<a href="https://headroom.example/">Open Headroom</a>',
      ].join("\n"),
    );
  });

  test("escapes HTML, adds identity, skips a null plan and a missing link", () => {
    const text = telegramText(
      syntheticEvent({
        title: "A <b> & C",
        connection: { id: "c1", name: "R&D <x>", plan: null, identity: "me@example.com" },
      }),
    );
    expect(text).toBe(
      "<b>A &lt;b&gt; &amp; C</b>\n78% used. Resets in 52 min.\nClaude · R&amp;D &lt;x&gt; · me@example.com",
    );
  });
});

describe("telegram calls", () => {
  test("sendMessage posts the documented body with the fixed options", async () => {
    const { calls, fetchFn } = fake(() => json({ ok: true, result: {} }));
    const result = await telegramSend(fetchFn, { botToken: token, chatId: "-100" }, "hi");
    expect(result).toEqual({ ok: true });
    const call = calls[0];
    expect(call?.url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(JSON.parse(bodyText(call?.init ?? {}))).toEqual({
      chat_id: "-100",
      text: "hi",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
    expect(call?.init.redirect).toBe("manual");
    expect(headerMap(call?.init ?? {})["user-agent"]).toMatch(/^Headroom\//);
    expect(call?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("failures map to classes, and 429 carries retry_after", async () => {
    const cases: [number, unknown, NotificationDeliveryFailure][] = [
      [401, { ok: false, error_code: 401, description: "Unauthorized" }, "unauthorized"],
      [403, { ok: false, description: "Forbidden: bot was blocked by the user" }, "not_found"],
      [400, { ok: false, description: "Bad Request: chat not found" }, "not_found"],
      [400, { ok: false, description: "Bad Request: text is empty" }, "rejected"],
      [404, {}, "not_found"],
      [500, "oops", "server_error"],
      [302, null, "rejected"],
    ];
    for (const [status, body, failure] of cases) {
      const { fetchFn } = fake(() => json(body, status));
      const result = await telegramSend(fetchFn, { botToken: token, chatId: "1" }, "x");
      expect(result).toEqual({ ok: false, failure });
    }
    const limited = fake(() =>
      json({ ok: false, parameters: { retry_after: 42 }, description: "Too Many Requests" }, 429),
    );
    expect(await telegramSend(limited.fetchFn, { botToken: token, chatId: "1" }, "x")).toEqual({
      ok: false,
      failure: "rate_limited",
      retryAfterSeconds: 42,
    });
  });

  test("timeout and network errors map to their classes without keeping the message", async () => {
    const timeout = Object.assign(new Error("secret in url"), { name: "TimeoutError" });
    const a = await telegramSend(
      fake(() => timeout).fetchFn,
      { botToken: token, chatId: "1" },
      "x",
    );
    expect(a).toEqual({ ok: false, failure: "timeout" });
    const b = await telegramSend(
      fake(() => new Error(`connect ${token}`)).fetchFn,
      { botToken: token, chatId: "1" },
      "x",
    );
    expect(b).toEqual({ ok: false, failure: "network" });
  });

  test("getMe returns the username", async () => {
    const { fetchFn } = fake(() => json({ ok: true, result: { username: "synthetic_bot" } }));
    expect(await telegramGetMe(fetchFn, token)).toEqual({ ok: true, username: "synthetic_bot" });
  });

  test("getUpdates returns unique chats with titles", async () => {
    const { fetchFn } = fake(() =>
      json({
        ok: true,
        result: [
          {
            update_id: 1,
            message: { chat: { id: 5, type: "private", first_name: "Ada", last_name: "L" } },
          },
          {
            update_id: 2,
            message: { chat: { id: 5, type: "private", first_name: "Ada", last_name: "L" } },
          },
          {
            update_id: 3,
            my_chat_member: { chat: { id: -100, type: "supergroup", title: "Ops" } },
          },
          { update_id: 4, channel_post: { chat: { id: -200, type: "channel", title: "News" } } },
          { update_id: 5, poll: {} },
        ],
      }),
    );
    expect(await telegramGetChats(fetchFn, token)).toEqual({
      ok: true,
      chats: [
        { id: "5", title: "Ada L", type: "private" },
        { id: "-100", title: "Ops", type: "supergroup" },
        { id: "-200", title: "News", type: "channel" },
      ],
    });
  });
});

describe("webhook", () => {
  const secretBytes = Buffer.from("synthetic-secret-bytes-0123456789");
  const secret = `whsec_${secretBytes.toString("base64")}`;

  test("signs as Standard Webhooks and sends the documented headers and body", async () => {
    const { calls, fetchFn } = fake(() => new Response(null, { status: 204 }));
    const event = syntheticEvent();
    const id = webhookMessageId("ch1", event.id);
    const result = await webhookSend(
      fetchFn,
      { url: "http://192.168.1.5:8080/hook", secret },
      { type: "notification", id, event },
      1_790_000_000_500,
    );
    expect(result).toEqual({ ok: true });
    const call = calls[0];
    const headers = headerMap(call?.init ?? {});
    const body = bodyText(call?.init ?? {});
    expect(headers["webhook-id"]).toBe(id);
    expect(id).toMatch(/^msg_[A-Za-z0-9_-]{32}$/);
    expect(headers["webhook-timestamp"]).toBe("1790000000");
    expect(headers["x-headroom-event"]).toBe("running_low");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(body)).toEqual({
      type: "notification",
      timestamp: new Date(1_790_000_000_500).toISOString(),
      data: event,
    });
    const expected = createHmac("sha256", secretBytes)
      .update(`${id}.1790000000.${body}`)
      .digest("base64");
    expect(headers["webhook-signature"]).toBe(`v1,${expected}`);
    expect(call?.init.redirect).toBe("manual");
  });

  test("a test message has its own type and a random id", async () => {
    const { calls, fetchFn } = fake(() => new Response(null, { status: 200 }));
    await webhookSend(fetchFn, { url: "https://example.com/h", secret }, { type: "test" }, 1000);
    await webhookSend(fetchFn, { url: "https://example.com/h", secret }, { type: "test" }, 1000);
    const [a, b] = calls.map((c) => headerMap(c.init));
    expect(a?.["x-headroom-event"]).toBe("test");
    expect(a?.["webhook-id"]).not.toBe(b?.["webhook-id"]);
    expect(JSON.parse(bodyText(calls[0]?.init ?? {})).data).toEqual({
      message: "Notifications will arrive at this URL.",
    });
  });

  test("status classes: 2xx delivers, 3xx is rejected, others map", async () => {
    const cases: [number, NotificationDeliveryFailure | null][] = [
      [200, null],
      [301, "rejected"],
      [401, "unauthorized"],
      [404, "not_found"],
      [410, "rejected"],
      [429, "rate_limited"],
      [503, "server_error"],
    ];
    for (const [status, failure] of cases) {
      const { fetchFn } = fake(() => new Response("body must not matter", { status }));
      const result = await webhookSend(
        fetchFn,
        { url: "https://e.com/", secret },
        { type: "test" },
        0,
      );
      expect(result).toEqual(failure ? { ok: false, failure } : { ok: true });
    }
  });

  test("webhook-id is stable per channel and event", () => {
    expect(webhookMessageId("a", "e")).toBe(webhookMessageId("a", "e"));
    expect(webhookMessageId("a", "e")).not.toBe(webhookMessageId("b", "e"));
  });

  test("url rules: http and https only, no credentials", () => {
    expect(parseWebhookUrl("http://192.168.1.5/x")).not.toBeNull();
    expect(parseWebhookUrl("https://example.com/x?y=1")).not.toBeNull();
    expect(parseWebhookUrl("ftp://example.com/")).toBeNull();
    expect(parseWebhookUrl("https://user:pw@example.com/")).toBeNull();
    expect(parseWebhookUrl("https://user@example.com/")).toBeNull();
    expect(parseWebhookUrl("not a url")).toBeNull();
  });
});
