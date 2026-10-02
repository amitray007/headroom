import { createHash, createHmac, randomUUID } from "node:crypto";

import type { WebhookConfig } from "@headroom/core";
import type { NotificationEvent } from "@headroom/core/contracts";

import { type Fetch, failureForStatus, post, type SendResult } from "./http.ts";

/**
 * Webhook delivery, signed as Standard Webhooks (standardwebhooks.com): `webhook-id`,
 * `webhook-timestamp` (unix seconds) and `webhook-signature: v1,<base64 HMAC-SHA256>` over
 * `<id>.<timestamp>.<body>`, keyed with the base64-decoded part of the secret after `whsec_`.
 * The response body is never read: only the status code matters.
 */

const secretPrefix = "whsec_";

/** The URL when it is `http:` or `https:` and carries no credentials; otherwise null. */
export function parseWebhookUrl(text: string): URL | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url;
}

/** Stable per channel and event, so a receiver can drop a retry. */
export function webhookMessageId(channelId: string, eventId: string): string {
  const digest = createHash("sha256").update(`${channelId}:${eventId}`).digest("base64url");
  return `msg_${digest.slice(0, 32)}`;
}

function sign(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(
    secret.startsWith(secretPrefix) ? secret.slice(secretPrefix.length) : secret,
    "base64",
  );
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

export type WebhookMessage =
  | { readonly type: "notification"; readonly id: string; readonly event: NotificationEvent }
  | { readonly type: "test" };

export async function webhookSend(
  fetchFn: Fetch,
  config: WebhookConfig,
  message: WebhookMessage,
  nowMs: number,
): Promise<SendResult> {
  const timestamp = Math.floor(nowMs / 1000);
  const body = JSON.stringify({
    type: message.type,
    timestamp: new Date(nowMs).toISOString(),
    data:
      message.type === "notification"
        ? message.event
        : { message: "Notifications will arrive at this URL." },
  });
  const id =
    message.type === "notification" ? message.id : `msg_${randomUUID().replaceAll("-", "")}`;
  const response = await post(
    fetchFn,
    config.url,
    {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": sign(config.secret, id, timestamp, body),
      "x-headroom-event": message.type === "notification" ? message.event.kind : "test",
    },
    body,
  );
  if (response === "timeout" || response === "network") return { ok: false, failure: response };
  await response.body?.cancel().catch(() => undefined);
  return response.status >= 200 && response.status < 300
    ? { ok: true }
    : { ok: false, failure: failureForStatus(response.status) };
}
