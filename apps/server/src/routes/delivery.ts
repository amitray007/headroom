import { Hono } from "hono";
import { z } from "zod";

import {
  type ChannelRow,
  type NotificationDeliveryFailure,
  generateWebhookSecret,
} from "@headroom/core";

import type { AppContext } from "../bootstrap.ts";
import { type Env, requireSession } from "../middleware/session.ts";
import { telegramTestText } from "../notify/format.ts";
import { telegramGetChats, telegramGetMe, telegramSend } from "../notify/telegram.ts";
import { parseWebhookUrl, webhookSend } from "../notify/webhook.ts";

/** Server-side notification channels. Responses never carry a token, chat id, URL or secret. */

const tokenShape = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const chatIdShape = /^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/;
const botToken = z.string().regex(tokenShape);
const chatId = z.string().regex(chatIdShape);
const chatTitle = z.string().trim().max(128);
const webhookUrl = z
  .string()
  .max(2048)
  .refine((value) => parseWebhookUrl(value) !== null);

const createBody = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("telegram"),
    botToken,
    chatId,
    chatTitle: chatTitle.optional(),
    includeIdentity: z.boolean().default(false),
  }),
  z.strictObject({
    type: z.literal("webhook"),
    url: webhookUrl,
    includeIdentity: z.boolean().default(false),
  }),
]);

const patchBody = z.strictObject({
  enabled: z.boolean().optional(),
  includeIdentity: z.boolean().optional(),
  botToken: botToken.optional(),
  chatId: chatId.optional(),
  chatTitle: chatTitle.optional(),
  url: webhookUrl.optional(),
});

const chatsBody = z.union([
  z.strictObject({ botToken }),
  z.strictObject({ channelId: z.string().min(1) }),
]);

/** A rejected token is the owner's to fix; a transport or server problem is a 502 with its class. */
const tokenProblems: ReadonlySet<NotificationDeliveryFailure> = new Set([
  "unauthorized",
  "not_found",
  "rejected",
]);

function labelFor(username: string, title: string | undefined): string {
  return title ? `@${username} · ${title}` : `@${username}`;
}

export function deliveryRoutes(ctx: AppContext): Hono<Env> {
  const app = new Hono<Env>();
  app.use(requireSession(ctx));

  const view = (channel: ChannelRow) => {
    const last = ctx.deliveries.lastDelivery(channel.id);
    return {
      id: channel.id,
      type: channel.type,
      enabled: channel.enabled,
      includeIdentity: channel.includeIdentity,
      label: channel.label,
      createdAt: channel.createdAt.getTime(),
      lastDelivery: last
        ? { status: last.status, at: last.at.getTime(), failure: last.failure }
        : null,
    };
  };

  app.get("/channels", (c) => c.json({ channels: ctx.channels.list().map(view) }));

  app.post("/channels", async (c) => {
    const body = createBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const input = body.data;
    if (input.type === "webhook") {
      const secret = generateWebhookSecret();
      const url = parseWebhookUrl(input.url);
      if (!url) return c.json({ error: "invalid_body" }, 400);
      const channel = ctx.channels.create(
        "webhook",
        { url: url.toString(), secret },
        { includeIdentity: input.includeIdentity, label: url.host },
      );
      return c.json({ channel: view(channel), secret }, 201);
    }
    const me = await telegramGetMe(ctx.fetch, input.botToken);
    if (!me.ok) return tokenFailure(c, me.failure);
    const channel = ctx.channels.create(
      "telegram",
      { botToken: input.botToken, chatId: input.chatId },
      { includeIdentity: input.includeIdentity, label: labelFor(me.username, input.chatTitle) },
    );
    return c.json({ channel: view(channel) }, 201);
  });

  app.patch("/channels/:id", async (c) => {
    const body = patchBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const patch = body.data;
    const id = c.req.param("id");
    const current = ctx.channels.get(id);
    const config = current ? ctx.channels.secretConfig(id) : null;
    if (!current || !config) return c.json({ error: "not_found" }, 404);
    const base = { enabled: patch.enabled, includeIdentity: patch.includeIdentity };
    const update: Parameters<typeof ctx.channels.update>[1] = {
      ...(base.enabled === undefined ? {} : { enabled: base.enabled }),
      ...(base.includeIdentity === undefined ? {} : { includeIdentity: base.includeIdentity }),
    };
    if (config.type === "webhook") {
      if (patch.botToken || patch.chatId || patch.chatTitle !== undefined)
        return c.json({ error: "invalid_body" }, 400);
      const url = patch.url === undefined ? null : parseWebhookUrl(patch.url);
      if (url) {
        Object.assign(update, {
          config: { url: url.toString(), secret: config.secret },
          label: url.host,
        });
      }
    } else {
      if (patch.url !== undefined) return c.json({ error: "invalid_body" }, 400);
      const nextToken = patch.botToken ?? config.botToken;
      const nextChat = patch.chatId ?? config.chatId;
      const prefix = current.label.split(" · ")[0] ?? current.label;
      let username = prefix.replace(/^@/, "");
      if (patch.botToken !== undefined && patch.botToken !== config.botToken) {
        const me = await telegramGetMe(ctx.fetch, patch.botToken);
        if (!me.ok) return tokenFailure(c, me.failure);
        username = me.username;
      }
      const touched =
        patch.botToken !== undefined || patch.chatId !== undefined || patch.chatTitle !== undefined;
      if (touched) {
        // A new chat id without a title drops the old title: it named the previous chat.
        const title =
          patch.chatTitle ??
          (patch.chatId === undefined || patch.chatId === config.chatId
            ? current.label.split(" · ").slice(1).join(" · ")
            : "");
        Object.assign(update, {
          config: { botToken: nextToken, chatId: nextChat },
          label: labelFor(username, title || undefined),
        });
      }
    }
    const channel = ctx.channels.update(id, update);
    return channel ? c.json({ channel: view(channel) }) : c.json({ error: "not_found" }, 404);
  });

  app.delete("/channels/:id", (c) => {
    if (!ctx.channels.delete(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
    return c.body(null, 204);
  });

  app.post("/channels/:id/test", async (c) => {
    const id = c.req.param("id");
    const config = ctx.channels.get(id) ? ctx.channels.secretConfig(id) : null;
    if (!config) return c.json({ error: "not_found" }, 404);
    // Test sends are not recorded as deliveries.
    const result =
      config.type === "telegram"
        ? await telegramSend(ctx.fetch, config, telegramTestText)
        : await webhookSend(ctx.fetch, config, { type: "test" }, ctx.now().getTime());
    return result.ok ? c.json({ ok: true }) : c.json({ error: result.failure }, 502);
  });

  app.post("/channels/:id/secret", (c) => {
    const id = c.req.param("id");
    const config = ctx.channels.get(id) ? ctx.channels.secretConfig(id) : null;
    if (!config) return c.json({ error: "not_found" }, 404);
    if (config.type !== "webhook") return c.json({ error: "unsupported_channel" }, 400);
    const secret = generateWebhookSecret();
    ctx.channels.update(id, { config: { url: config.url, secret } });
    return c.json({ secret });
  });

  app.post("/telegram/chats", async (c) => {
    const body = chatsBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    let token: string;
    if ("botToken" in body.data) {
      token = body.data.botToken;
    } else {
      const id = body.data.channelId;
      const config = ctx.channels.get(id) ? ctx.channels.secretConfig(id) : null;
      if (!config) return c.json({ error: "not_found" }, 404);
      if (config.type !== "telegram") return c.json({ error: "unsupported_channel" }, 400);
      token = config.botToken;
    }
    const me = await telegramGetMe(ctx.fetch, token);
    if (!me.ok) return tokenFailure(c, me.failure);
    const chats = await telegramGetChats(ctx.fetch, token);
    if (!chats.ok) return c.json({ error: chats.failure }, 502);
    return c.json({ bot: { username: me.username }, chats: chats.chats });
  });

  return app;
}

function tokenFailure(
  c: { json: (body: unknown, status: 400 | 502) => Response },
  failure: NotificationDeliveryFailure,
): Response {
  return tokenProblems.has(failure)
    ? c.json({ error: "telegram_token_rejected" }, 400)
    : c.json({ error: failure }, 502);
}
