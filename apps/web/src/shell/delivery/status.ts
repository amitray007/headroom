import {
  notificationDeliveryFailureSchema,
  type NotificationChannelType,
  type NotificationDeliveryFailure,
} from "@headroom/core/contracts";
import { age } from "@headroom/view-model/time";

import type { ChannelView } from "../../api.ts";

const texts: Record<NotificationChannelType, Record<NotificationDeliveryFailure, string>> = {
  telegram: {
    timeout: "It took too long to answer.",
    network: "Headroom could not reach it.",
    unauthorized: "Telegram did not accept the bot token.",
    not_found: "The chat was not found. Send your bot a message first.",
    rate_limited: "Too many messages. Headroom will try again.",
    rejected: "The message was rejected.",
    server_error: "The other side had an error.",
  },
  webhook: {
    timeout: "Headroom could not reach this URL.",
    network: "Headroom could not reach this URL.",
    unauthorized: "Your receiver refused it. Check that it uses this secret.",
    not_found: "Nothing answered at this path.",
    rate_limited: "Too many messages. Headroom will try again.",
    rejected: "Your receiver rejected the request.",
    server_error: "Your receiver had an error.",
  },
};

/** Why a send failed, in plain words. */
export function failureText(
  type: NotificationChannelType,
  failure: NotificationDeliveryFailure,
): string {
  return texts[type][failure];
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

export const saveProblem = "Headroom could not save this. Check the details and try again.";
export const changeProblem = "Headroom could not save that change. Try again.";

/** Why a test send failed, from the error word the server sent. */
export function testProblem(type: NotificationChannelType, code: string | null): string {
  const failure = notificationDeliveryFailureSchema.safeParse(code);
  return failure.success ? failureText(type, failure.data) : "Headroom could not send it.";
}

/** The name of a destination. */
export function destinationName(type: NotificationChannelType): string {
  return type === "telegram" ? "Telegram" : "Webhook";
}

/** What a destination card says under its name. `tone` colours the dot. */
export function destinationState(
  channel: Pick<ChannelView, "type" | "enabled" | "lastDelivery"> | null,
  now: number,
): {
  readonly word: "Not Set Up" | "On" | "Off";
  readonly detail: string | null;
  readonly tone: "good" | "bad" | "quiet";
} {
  if (channel === null) return { word: "Not Set Up", detail: null, tone: "quiet" };
  if (!channel.enabled) return { word: "Off", detail: null, tone: "quiet" };
  if (channel.lastDelivery === null) return { word: "On", detail: null, tone: "good" };
  const line = statusLine(channel, now);
  return { word: "On", detail: line.text, tone: line.tone === "bad" ? "bad" : "good" };
}

/** The bot name in a Telegram channel label such as "@bot \u00b7 Family". */
export function botNameOf(label: string): string {
  return label.split(" \u00b7 ")[0] ?? label;
}

/** Why a bot token check failed, from the error word the server sent. */
export function botCheckProblem(code: string | null): string {
  return code === "telegram_token_rejected" || code === "unauthorized"
    ? "Telegram did not accept this token. Copy it again from BotFather."
    : "Headroom could not reach Telegram. Try again.";
}
