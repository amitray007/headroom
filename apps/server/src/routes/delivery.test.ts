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
});
