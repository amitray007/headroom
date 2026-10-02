import {
  notificationDeliveryFailureSchema,
  type NotificationChannelType,
  type NotificationDeliveryFailure,
} from "@headroom/core/contracts";
import { age } from "@headroom/view-model/time";

import type { ChannelView } from "../../api.ts";

const common: Record<NotificationDeliveryFailure, string> = {
  timeout: "It took too long to answer.",
  network: "Headroom could not reach it.",
  unauthorized: "",
  not_found: "",
  rate_limited: "Too many messages. Headroom will try again.",
  rejected: "The message was rejected.",
  server_error: "The other side had an error.",
};

const specific: Record<
  NotificationChannelType,
  Pick<Record<NotificationDeliveryFailure, string>, "unauthorized" | "not_found">
> = {
  telegram: {
    unauthorized: "Telegram did not accept the bot token.",
    not_found: "The chat was not found. Send your bot a message first.",
  },
  webhook: {
    unauthorized: "The URL refused the request.",
    not_found: "The URL was not found.",
  },
};

/** Why a send failed, in plain words. */
export function failureText(
  type: NotificationChannelType,
  failure: NotificationDeliveryFailure,
): string {
  if (failure === "unauthorized" || failure === "not_found") return specific[type][failure];
  return common[failure];
}

/** The status line under a channel. `tone` colours it. */
export function statusLine(
  channel: Pick<ChannelView, "type" | "lastDelivery">,
  now: number,
): { readonly text: string; readonly tone: "good" | "warn" | "bad" | "quiet" } {
  const last = channel.lastDelivery;
  // The line reads as a sentence, so "Just now" drops its capital mid-line.
  const ago = (at: number): string => age(at, now).replace(/^Just now$/, "just now");
  if (last === null) return { text: "Nothing sent yet", tone: "quiet" };
  const reason = last.failure === null ? "" : failureText(channel.type, last.failure);
  const join = (lead: string): string => (reason === "" ? lead : `${lead} ${reason}`);
  if (last.status === "delivered") return { text: `Last sent ${ago(last.at)}`, tone: "good" };
  if (last.status === "retrying") return { text: join("Retrying."), tone: "warn" };
  return { text: join(`Last failed ${ago(last.at)}.`), tone: "bad" };
}

/** The word for a Telegram chat type. */
export function chatTypeWord(type: string): string {
  if (type === "private") return "Private";
  if (type === "group" || type === "supergroup") return "Group";
  if (type === "channel") return "Channel";
  return "Chat";
}

/** True when `text` is a full http or https URL. */
export function isFullUrl(text: string): boolean {
  if (!/^https?:\/\//i.test(text.trim())) return false;
  try {
    return new URL(text.trim()).hostname !== "";
  } catch {
    return false;
  }
}

export const urlProblem = "Enter a full URL, starting with https://.";
export const saveProblem = "Headroom could not save this. Check the details and try again.";
export const changeProblem = "Headroom could not save that change. Try again.";

/** A plain sentence for a failed save or lookup, from the error word the server sent. */
export function problemText(code: string | null, fallback: string): string {
  if (code === "telegram_token_rejected") return "Telegram did not accept this token.";
  return fallback;
}

/** Why a test send failed, from the error word the server sent. */
export function testProblem(type: NotificationChannelType, code: string | null): string {
  const failure = notificationDeliveryFailureSchema.safeParse(code);
  return failure.success ? failureText(type, failure.data) : "Headroom could not send it.";
}
