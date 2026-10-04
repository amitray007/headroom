import type { NotificationEvent } from "@headroom/core/contracts";
import { planLabel, providerName } from "@headroom/view-model/labels";

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The Telegram message for one event: headline, sentence, account line, dashboard link. */
export function telegramText(event: NotificationEvent): string {
  const plan = planLabel(event.connection.plan);
  const account = [
    providerName(event.provider),
    event.connection.name,
    ...(plan === null ? [] : [plan]),
    ...(event.connection.identity === undefined ? [] : [event.connection.identity]),
  ]
    .map(escapeHtml)
    .join(" · ");
  const lines = [`<b>${escapeHtml(event.title)}</b>`, escapeHtml(event.message), account];
  if (event.links.dashboard) {
    lines.push(
      `<a href="${escapeHtml(event.links.dashboard).replaceAll('"', "&quot;")}">Open Headroom</a>`,
    );
  }
  return lines.join("\n");
}

export const telegramTestText = "<b>Headroom Test</b>\nNotifications will arrive in this chat.";
