import { z } from "zod";

import { devicePrefs } from "../lib/device-prefs.ts";
import { demoReadyEvent } from "../lib/site.ts";
import { href, parseRoute } from "../router.ts";

/** The landing page embeds the demo in an iframe and talks to it by `postMessage`, on the same origin only. */

const pageSchema = z.enum(["overview", "detailed", "compare", "timeline", "wallet", "connect"]);
const messageSchema = z.discriminatedUnion("type", [
  z.object({ source: z.literal("headroom-site"), type: z.literal("navigate"), page: pageSchema }),
  z.object({
    source: z.literal("headroom-site"),
    type: z.literal("scheme"),
    scheme: z.enum(["light", "dark", "system"]),
  }),
]);

export type SiteMessage = z.infer<typeof messageSchema>;

/** The message from the landing page, or null for anything else. */
export function parseSiteMessage(data: unknown): SiteMessage | null {
  const parsed = messageSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function isEmbedded(search: string): boolean {
  return new URLSearchParams(search).get("embed") === "1";
}

function post(message: Record<string, string>): void {
  window.parent.postMessage({ source: "headroom-demo", ...message }, window.location.origin);
}

function announceRoute(): void {
  post({ type: "route", page: parseRoute(window.location.hash).page });
}

/** Listen to the landing page and report the ready state and the current page back to it. */
export function startEmbedBridge(): void {
  if (window.parent === window) return;
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    const message = parseSiteMessage(event.data);
    if (message === null) return;
    if (message.type === "navigate") window.location.hash = href({ page: message.page });
    else devicePrefs().setAppearance(message.scheme);
  });
  window.addEventListener("hashchange", announceRoute);
  window.addEventListener(
    demoReadyEvent,
    () => {
      post({ type: "ready" });
      announceRoute();
    },
    { once: true },
  );
}
