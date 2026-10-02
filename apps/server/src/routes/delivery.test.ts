/* eslint-disable no-await-in-loop -- the steps of a test run in order */
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { z } from "zod";

import { createApp } from "../app.ts";
import { bodyText, headerMap } from "../notify/fixtures.ts";
import type { Fetch } from "../notify/http.ts";
import { jsonPost, signedIn, testContext, url } from "../test-helpers.ts";

const token = "123456:SYNTHETIC-token-value-0123456789abcdef";
const otherToken = "654321:OTHER-synthetic-token-0123456789abcdefg";

function defaultRespond(u: string): Response {
  return u.endsWith("/getMe")
    ? Response.json({ ok: true, result: { username: "synthetic_bot" } })
    : Response.json({ ok: true, result: {} });
}

const channelView = z.object({
  id: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  includeIdentity: z.boolean(),
  label: z.string(),
  createdAt: z.number(),
  lastDelivery: z
    .object({ status: z.string(), at: z.number(), failure: z.string().nullable() })
    .nullable(),
});
const createdBody = z.object({ channel: channelView, secret: z.string().optional() });
const channelList = z.object({ channels: z.array(channelView) });
const secretBody = z.object({ secret: z.string() });

async function harness() {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  let respond = defaultRespond;
  const fetchFn: Fetch = async (u, init) => {
    calls.push({
      url: u,
      body: bodyText(init),
      headers: headerMap(init),
    });
    return respond(u);
  };
  const ctx = testContext({}, { fetch: fetchFn });
  const app = createApp(ctx);
  const cookie = await signedIn(ctx, app);
  const send = (method: string, path: string, body?: unknown) =>
    app.request(url(ctx, `/api/delivery${path}`), {
      ...jsonPost(ctx, body ?? {}, { cookie }),
      method,
      ...(body === undefined && method !== "POST" ? { body: undefined } : {}),
    });
  return {
    ctx,
    app,
    cookie,
    calls,
    send,
    setRespond: (fn: (url: string) => Response) => {
      respond = fn;
    },
  };
}

const createTelegram = { type: "telegram", botToken: token, chatId: "-100123", chatTitle: "Ops" };

describe("delivery routes", () => {
  test("every route needs a session", async () => {
    const { app, ctx } = await harness();
    expect((await app.request(url(ctx, "/api/delivery/channels"))).status).toBe(401);
  });

  test("a cross-site write is rejected", async () => {
    const { app, ctx, cookie } = await harness();
    const response = await app.request(
      url(ctx, "/api/delivery/channels"),
      jsonPost(ctx, createTelegram, { cookie, "sec-fetch-site": "cross-site" }),
    );
    expect(response.status).toBe(403);
  });

  test("create a Telegram channel: verifies the token and labels it", async () => {
    const { send, calls } = await harness();
    const response = await send("POST", "/channels", { ...createTelegram, includeIdentity: true });
    expect(response.status).toBe(201);
    const body = createdBody.parse(await response.json());
    expect(body.secret).toBeUndefined();
    expect(body.channel).toMatchObject({
      type: "telegram",
      enabled: true,
      includeIdentity: true,
      label: "@synthetic_bot · Ops",
      lastDelivery: null,
    });
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${token}/getMe`);
  });

  test("a rejected token is 400 telegram_token_rejected and nothing is stored", async () => {
    const { send, setRespond, ctx } = await harness();
    setRespond(() => Response.json({ ok: false, error_code: 401 }, { status: 401 }));
    const response = await send("POST", "/channels", createTelegram);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "telegram_token_rejected" });
    expect(ctx.channels.list()).toHaveLength(0);
  });

  test("invalid bodies are 400 invalid_body", async () => {
    const { send } = await harness();
    for (const body of [
      { type: "telegram", botToken: "nope", chatId: "1" },
      { type: "telegram", botToken: token, chatId: "bad id" },
      { type: "webhook", url: "ftp://example.com" },
      { type: "webhook", url: "https://user:pw@example.com" },
      { type: "mystery" },
    ]) {
      const response = await send("POST", "/channels", body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_body" });
    }
  });

  test("create a webhook: secret shown once, label is the host only, GET never returns secrets", async () => {
    const { send } = await harness();
    const response = await send("POST", "/channels", {
      type: "webhook",
      url: "http://192.168.1.5:8080/private/path?key=zzqq",
    });
    expect(response.status).toBe(201);
    const body = createdBody.parse(await response.json());
    const secret = body.secret ?? "";
    expect(secret).toMatch(/^whsec_/);
    expect(body.channel.label).toBe("192.168.1.5:8080");
    const list = await (await send("GET", "/channels")).text();
    expect(list).not.toContain(secret);
    expect(list).not.toContain("private/path");
    expect(list).not.toContain("zzqq");
    expect(list).not.toContain(token);
  });

  test("list shows the last delivery", async () => {
    const { send, ctx } = await harness();
    const created = createdBody.parse(
      await (await send("POST", "/channels", createTelegram)).json(),
    );
    ctx.deliveries.recordAttempt({
      channelId: created.channel.id,
      eventId: "e1",
      kind: "running_low",
      status: "retrying",
      attempts: 1,
      failure: "timeout",
      at: new Date(1_790_000_000_000),
      nextAttemptAt: new Date(1_790_000_060_000),
    });
    const list = channelList.parse(await (await send("GET", "/channels")).json());
    expect(list.channels[0]?.lastDelivery).toEqual({
      status: "retrying",
      at: 1_790_000_000_000,
      failure: "timeout",
    });
  });

  test("patch flags, re-verifies a changed token, and updates the label", async () => {
    const { send, calls, ctx } = await harness();
    const created = createdBody.parse(
      await (await send("POST", "/channels", createTelegram)).json(),
    );
    const id = created.channel.id;
    const flags = await send("PATCH", `/channels/${id}`, { enabled: false, includeIdentity: true });
    expect(createdBody.parse(await flags.json()).channel).toMatchObject({
      enabled: false,
      includeIdentity: true,
      label: "@synthetic_bot · Ops",
    });
    expect(calls).toHaveLength(1);
    const swapped = await send("PATCH", `/channels/${id}`, { botToken: otherToken });
    expect(swapped.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain(otherToken);
    expect(ctx.channels.secretConfig(id)).toMatchObject({
      botToken: otherToken,
      chatId: "-100123",
    });
    const chat = await send("PATCH", `/channels/${id}`, { chatId: "-200", chatTitle: "News" });
    expect(createdBody.parse(await chat.json()).channel.label).toBe("@synthetic_bot · News");
  });

  test("patch rejects fields of the other type and unknown ids", async () => {
    const { send } = await harness();
    const created = createdBody.parse(
      await (await send("POST", "/channels", createTelegram)).json(),
    );
    expect(
      (await send("PATCH", `/channels/${created.channel.id}`, { url: "https://example.com" }))
        .status,
    ).toBe(400);
    expect((await send("PATCH", "/channels/missing", { enabled: false })).status).toBe(404);
  });

  test("test sends are not recorded; failures are 502 with the class", async () => {
    const { send, setRespond, ctx } = await harness();
    const created = createdBody.parse(
      await (await send("POST", "/channels", createTelegram)).json(),
    );
    const id = created.channel.id;
    const ok = await send("POST", `/channels/${id}/test`);
    expect(await ok.json()).toEqual({ ok: true });
    setRespond(() => Response.json({ ok: false }, { status: 403 }));
    const failed = await send("POST", `/channels/${id}/test`);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: "unauthorized" });
    expect(ctx.deliveries.lastDelivery(id)).toBeNull();
    expect((await send("POST", "/channels/missing/test")).status).toBe(404);
  });

  test("webhook test is signed, and rotating the secret changes the key", async () => {
    const { send, calls, ctx } = await harness();
    const created = createdBody.parse(
      await (
        await send("POST", "/channels", { type: "webhook", url: "https://example.com/hook" })
      ).json(),
    );
    const id = created.channel.id;
    const firstSecret = created.secret ?? "";
    expect((await send("POST", `/channels/${id}/test`)).status).toBe(200);
    const call = calls.at(-1);
    const sign = (secret: string) =>
      `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
        .update(
          `${call?.headers["webhook-id"]}.${call?.headers["webhook-timestamp"]}.${call?.body}`,
        )
        .digest("base64")}`;
    expect(call?.headers["webhook-signature"]).toBe(sign(firstSecret));
    const rotated = secretBody.parse(await (await send("POST", `/channels/${id}/secret`)).json());
    expect(rotated.secret).not.toBe(firstSecret);
    expect(ctx.channels.secretConfig(id)).toMatchObject({ secret: rotated.secret });
    await send("POST", `/channels/${id}/test`);
    expect(calls.at(-1)?.headers["webhook-signature"]).not.toBe(sign(firstSecret));
  });

  test("rotating a Telegram channel is refused", async () => {
    const { send } = await harness();
    const created = createdBody.parse(
      await (await send("POST", "/channels", createTelegram)).json(),
    );
    expect((await send("POST", `/channels/${created.channel.id}/secret`)).status).toBe(400);
  });

  test("delete returns 204 then 404", async () => {
    const { send } = await harness();
    const created = createdBody.parse(
      await (await send("POST", "/channels", createTelegram)).json(),
    );
    const path = `/channels/${created.channel.id}`;
    expect((await send("DELETE", path)).status).toBe(204);
    expect((await send("DELETE", path)).status).toBe(404);
  });

  test("discover chats by token or by channel id", async () => {
    const { send, setRespond } = await harness();
    setRespond((u) =>
      u.endsWith("/getMe")
        ? Response.json({ ok: true, result: { username: "synthetic_bot" } })
        : Response.json({
            ok: true,
            result: [
              { update_id: 1, message: { chat: { id: 7, type: "private", first_name: "Ada" } } },
            ],
          }),
    );
    const expected = {
      bot: { username: "synthetic_bot" },
      chats: [{ id: "7", title: "Ada", type: "private" }],
    };
    const byToken = await send("POST", "/telegram/chats", { botToken: token });
    expect(await byToken.json()).toEqual(expected);
    const created = createdBody.parse(
      await (await send("POST", "/channels", createTelegram)).json(),
    );
    const byChannel = await send("POST", "/telegram/chats", { channelId: created.channel.id });
    expect(await byChannel.json()).toEqual(expected);
    setRespond(() => Response.json({ ok: false }, { status: 401 }));
    const bad = await send("POST", "/telegram/chats", { botToken: token });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "telegram_token_rejected" });
  });

  const clientSecret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
  const otherSecret = `whsec_${Buffer.alloc(32, 9).toString("base64")}`;

  test("bot endpoint returns username and name, and maps failures", async () => {
    const { send, setRespond } = await harness();
    setRespond(() =>
      Response.json({ ok: true, result: { username: "synthetic_bot", first_name: "Synth" } }),
    );
    const ok = await send("POST", "/telegram/bot", { botToken: token });
    expect(await ok.json()).toEqual({ bot: { username: "synthetic_bot", name: "Synth" } });
    setRespond(() => Response.json({ ok: true, result: { username: "synthetic_bot" } }));
    const fallback = await send("POST", "/telegram/bot", { botToken: token });
    expect(await fallback.json()).toEqual({
      bot: { username: "synthetic_bot", name: "synthetic_bot" },
    });
    setRespond(() => Response.json({ ok: false }, { status: 401 }));
    const bad = await send("POST", "/telegram/bot", { botToken: token });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "telegram_token_rejected" });
    setRespond(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const slow = await send("POST", "/telegram/bot", { botToken: token });
    expect(slow.status).toBe(502);
    expect(await slow.json()).toEqual({ error: "timeout" });
    expect((await send("POST", "/telegram/bot", { botToken: "nope" })).status).toBe(400);
  });

  test("verify sends a Telegram test by token or channel id and saves nothing", async () => {
    const { send, setRespond, calls, ctx } = await harness();
    const sent = await send("POST", "/verify", {
      type: "telegram",
      botToken: token,
      chatId: "-100123",
    });
    expect(await sent.json()).toEqual({ ok: true });
    const call = calls.at(-1);
    expect(call?.url).toContain("/sendMessage");
    expect(JSON.parse(call?.body ?? "{}")).toMatchObject({ chat_id: "-100123" });
    expect(ctx.channels.list()).toEqual([]);
    const created = createdBody.parse(
      await (await send("POST", "/channels", createTelegram)).json(),
    );
    const byChannel = await send("POST", "/verify", {
      type: "telegram",
      channelId: created.channel.id,
      chatId: "-100999",
    });
    expect(await byChannel.json()).toEqual({ ok: true });
    expect(JSON.parse(calls.at(-1)?.body ?? "{}")).toMatchObject({ chat_id: "-100999" });
    expect(ctx.deliveries.lastDelivery(created.channel.id)).toBeNull();
    expect(ctx.channels.list()).toHaveLength(1);
    setRespond(() =>
      Response.json({ ok: false, description: "Bad Request: chat not found" }, { status: 400 }),
    );
    const missing = await send("POST", "/verify", {
      type: "telegram",
      botToken: token,
      chatId: "5",
    });
    expect(missing.status).toBe(502);
    expect(await missing.json()).toEqual({ error: "not_found" });
    const unknown = await send("POST", "/verify", {
      type: "telegram",
      channelId: "nope",
      chatId: "5",
    });
    expect(unknown.status).toBe(404);
    const hook = createdBody.parse(
      await (
        await send("POST", "/channels", { type: "webhook", url: "https://example.com/hook" })
      ).json(),
    );
    const wrong = await send("POST", "/verify", {
      type: "telegram",
      channelId: hook.channel.id,
      chatId: "5",
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "unsupported_channel" });
  });

  test("verify sends a webhook test signed with the supplied secret and saves nothing", async () => {
    const { send, setRespond, calls, ctx } = await harness();
    const response = await send("POST", "/verify", {
      type: "webhook",
      url: "https://example.com/hook",
      secret: clientSecret,
    });
    expect(await response.json()).toEqual({ ok: true });
    const call = calls.at(-1);
    const expected = `v1,${createHmac("sha256", Buffer.from(clientSecret.slice(6), "base64"))
      .update(`${call?.headers["webhook-id"]}.${call?.headers["webhook-timestamp"]}.${call?.body}`)
      .digest("base64")}`;
    expect(call?.headers["webhook-signature"]).toBe(expected);
    expect(ctx.channels.list()).toEqual([]);
    setRespond(() => new Response(null, { status: 401 }));
    const rejected = await send("POST", "/verify", {
      type: "webhook",
      url: "https://example.com/hook",
      secret: clientSecret,
    });
    expect(rejected.status).toBe(502);
    expect(await rejected.json()).toEqual({ error: "unauthorized" });
    for (const body of [
      { type: "webhook", url: "ftp://example.com", secret: clientSecret },
      { type: "webhook", url: "https://example.com", secret: "whsec_short" },
      { type: "webhook", url: "https://example.com" },
      { type: "telegram", chatId: "5" },
      { type: "other" },
    ]) {
      expect((await send("POST", "/verify", body)).status).toBe(400);
    }
  });

  test("a client secret is stored on create and not returned; bad secrets are rejected", async () => {
    const { send, ctx } = await harness();
    const response = await send("POST", "/channels", {
      type: "webhook",
      url: "https://example.com/hook",
      secret: clientSecret,
    });
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain(clientSecret);
    expect(text).not.toContain("secret");
    const id = createdBody.parse(JSON.parse(text)).channel.id;
    expect(ctx.channels.secretConfig(id)).toMatchObject({ secret: clientSecret });
    for (const secret of ["whsec_short", "plain", `whsec_${"A".repeat(31)}`, `${clientSecret}!`]) {
      const bad = await send("POST", "/channels", {
        type: "webhook",
        url: "https://example.com/hook",
        secret,
      });
      expect(bad.status).toBe(400);
    }
  });

  test("patch sets a webhook secret, refuses it on Telegram, and edits a chat without a token", async () => {
    const { send, ctx, calls } = await harness();
    const hook = createdBody.parse(
      await (
        await send("POST", "/channels", { type: "webhook", url: "https://example.com/hook" })
      ).json(),
    );
    const patched = await send("PATCH", `/channels/${hook.channel.id}`, { secret: otherSecret });
    expect(patched.status).toBe(200);
    expect(await patched.text()).not.toContain(otherSecret);
    expect(ctx.channels.secretConfig(hook.channel.id)).toMatchObject({
      url: "https://example.com/hook",
      secret: otherSecret,
    });
    expect(hook.channel.label).toBe("example.com");
    expect(
      (await send("PATCH", `/channels/${hook.channel.id}`, { secret: "whsec_x" })).status,
    ).toBe(400);
    const tg = createdBody.parse(await (await send("POST", "/channels", createTelegram)).json());
    expect(
      (await send("PATCH", `/channels/${tg.channel.id}`, { secret: otherSecret })).status,
    ).toBe(400);
    const before = calls.length;
    const moved = await send("PATCH", `/channels/${tg.channel.id}`, {
      chatId: "-100555",
      chatTitle: "Alerts",
    });
    expect(moved.status).toBe(200);
    expect(calls.length).toBe(before);
    expect(ctx.channels.secretConfig(tg.channel.id)).toMatchObject({
      botToken: token,
      chatId: "-100555",
    });
    expect(ctx.channels.get(tg.channel.id)?.label).toBe("@synthetic_bot · Alerts");
  });
});
