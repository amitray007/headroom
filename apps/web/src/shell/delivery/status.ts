import {
  notificationDeliveryFailureSchema,
  type NotificationChannelType,
  type NotificationDeliveryFailure,
} from "@headroom/core/contracts";
import { age } from "@headroom/view-model/time";

import { ApiError, demoRefusal, type ChannelView } from "../../api.ts";

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

/** The error word an API call failed with, when it sent one. */
export function codeOf(cause: unknown): string | null {
  return cause instanceof ApiError ? cause.code : null;
}

/** The demo site refuses every change with this word; the owner sees why instead of a failure. */
const isDemoCode = (code: string | null): boolean => code === "demo_mode";

/** Why a first save failed. */
export function saveProblem(code: string | null): string {
  return isDemoCode(code)
    ? demoRefusal
    : "Headroom could not save this. Check the details and try again.";
}

/** Why a change to a saved channel failed. */
export function changeProblem(code: string | null): string {
  return isDemoCode(code) ? demoRefusal : "Headroom could not save that change. Try again.";
}

/** Why making a new webhook secret failed. */
export function rotationProblem(code: string | null): string {
  return isDemoCode(code) ? demoRefusal : "Headroom could not make a new secret. Try again.";
}

/** Why a test send failed, from the error word the server sent. */
export function testProblem(type: NotificationChannelType, code: string | null): string {
  if (isDemoCode(code)) return demoRefusal;
  const failure = notificationDeliveryFailureSchema.safeParse(code);
  return failure.success ? failureText(type, failure.data) : "Headroom could not send it.";
}

/** The name of a destination. */
export function destinationName(type: NotificationChannelType): string {
  return type === "telegram" ? "Telegram" : "Webhook";
}

/**
 * The mark at the right of a destination card: a seal when it is set up (outlined when switched off), an alert when
 * its last send failed, nothing when it is not set up. `label` names the mark for assistive tech and on hover.
 */
export function destinationState(channel: Pick<ChannelView, "enabled" | "lastDelivery"> | null): {
  readonly mark: "none" | "on" | "off" | "failing";
  readonly label: string;
} {
  if (channel === null) return { mark: "none", label: "Not Set Up" };
  if (!channel.enabled) return { mark: "off", label: "Set Up, Off" };
  const last = channel.lastDelivery;
  if (last !== null && last.status !== "delivered")
    return { mark: "failing", label: "Not Sending" };
  return { mark: "on", label: "Set Up" };
}

/** The bot name in a Telegram channel label such as "@bot \u00b7 Family". */
export function botNameOf(label: string): string {
  return label.split(" \u00b7 ")[0] ?? label;
}

/** Why a bot token check failed, from the error word the server sent. */
export function botCheckProblem(code: string | null): string {
  if (isDemoCode(code)) return demoRefusal;
  return code === "telegram_token_rejected" || code === "unauthorized"
    ? "Telegram did not accept this token. Copy it again from BotFather."
    : "Headroom could not reach Telegram. Try again.";
}
