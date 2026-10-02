import { z } from "zod";

import type { NotificationDeliveryFailure, TelegramConfig } from "@headroom/core";

import { type Fetch, failureForStatus, post, type SendResult } from "./http.ts";

/**
 * Telegram Bot API calls. Responses are parsed for `ok`, `error_code`, `parameters.retry_after`
 * and the result only. `description` can echo request data, so it is used to classify a
 * failure and then dropped: never stored, never logged. The token sits in the URL, so nothing
 * here puts a URL or an error message in its output.
 */

const apiBase = "https://api.telegram.org";

const envelope = z.object({
  ok: z.boolean(),
  error_code: z.number().optional(),
  description: z.string().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
  result: z.unknown().optional(),
});

type Call = { ok: true; result: unknown } | Extract<SendResult, { ok: false }>;

async function call(
  fetchFn: Fetch,
  token: string,
  method: string,
  payload: unknown,
): Promise<Call> {
  const response = await post(
    fetchFn,
    `${apiBase}/bot${token}/${method}`,
    { "content-type": "application/json" },
    JSON.stringify(payload),
  );
  if (response === "timeout" || response === "network") return { ok: false, failure: response };
  const parsed = envelope.safeParse(await response.json().catch(() => null));
  const body = parsed.success ? parsed.data : null;
  if (response.ok && body?.ok) return { ok: true, result: body.result };
  const status = response.ok ? (body?.error_code ?? 400) : response.status;
  let failure: NotificationDeliveryFailure = failureForStatus(status);
  const description = body?.description?.toLowerCase() ?? "";
  if (status === 400 && description.includes("chat not found")) failure = "not_found";
  if (status === 403 && /blocked|kicked|not a member|deactivated/.test(description))
    failure = "not_found";
  const retryAfter = body?.parameters?.retry_after;
  return {
    ok: false,
    failure,
    ...(failure === "rate_limited" && retryAfter !== undefined
      ? { retryAfterSeconds: retryAfter }
      : {}),
  };
}

export async function telegramSend(
  fetchFn: Fetch,
  config: TelegramConfig,
  text: string,
): Promise<SendResult> {
  const result = await call(fetchFn, config.botToken, "sendMessage", {
    chat_id: config.chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  return result.ok ? { ok: true } : result;
}

export type MeResult =
  | { readonly ok: true; readonly username: string }
  | Extract<SendResult, { ok: false }>;

/** Verify a token and read the bot's username. */
export async function telegramGetMe(fetchFn: Fetch, botToken: string): Promise<MeResult> {
  const result = await call(fetchFn, botToken, "getMe", {});
  if (!result.ok) return result;
  const me = z.object({ username: z.string().min(1) }).safeParse(result.result);
  return me.success ? { ok: true, username: me.data.username } : { ok: false, failure: "rejected" };
}

interface TelegramChat {
  readonly id: string;
  readonly title: string;
  readonly type: string;
}

const chatSchema = z.object({
  id: z.number(),
  type: z.string(),
  title: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});
const updateSchema = z.object({
  message: z.object({ chat: chatSchema }).optional(),
  edited_message: z.object({ chat: chatSchema }).optional(),
  channel_post: z.object({ chat: chatSchema }).optional(),
  my_chat_member: z.object({ chat: chatSchema }).optional(),
});

export type ChatsResult =
  | { readonly ok: true; readonly chats: TelegramChat[] }
  | Extract<SendResult, { ok: false }>;

/** The unique chats in the bot's recent updates. Telegram keeps updates for 24 hours. */
export async function telegramGetChats(fetchFn: Fetch, botToken: string): Promise<ChatsResult> {
  const result = await call(fetchFn, botToken, "getUpdates", {
    limit: 100,
    timeout: 0,
    allowed_updates: ["message", "edited_message", "channel_post", "my_chat_member"],
  });
  if (!result.ok) return result;
  const updates = z.array(z.unknown()).safeParse(result.result);
  if (!updates.success) return { ok: false, failure: "rejected" };
  const chats = new Map<string, TelegramChat>();
  for (const raw of updates.data) {
    const update = updateSchema.safeParse(raw);
    if (!update.success) continue;
    const chat = (
      update.data.message ??
      update.data.edited_message ??
      update.data.channel_post ??
      update.data.my_chat_member
    )?.chat;
    if (!chat) continue;
    const id = String(chat.id);
    const person = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
    const title = chat.title ?? (person || (chat.username ?? id));
    chats.set(id, { id, title, type: chat.type });
  }
  return { ok: true, chats: [...chats.values()] };
}
