import type { NotificationEvent } from "@headroom/core/contracts";

/** A synthetic event for tests. */
export const syntheticEvent = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
  schemaVersion: 1,
  id: "c1:running_low:seven_day:1790000000000",
  kind: "running_low",
  tone: "warn",
  occurredAt: 1_789_990_000_000,
  observedAt: 1_789_990_000_000,
  provider: "claude",
  connection: { id: "c1", name: "Personal", plan: "max_5x" },
  subject: { metricKey: "seven_day", label: "Weekly", window: "all models" },
  figures: { percentUsed: 78, percentLeft: 22 },
  title: "Claude Weekly Limit Is Running Low",
  message: "78% used. Resets in 52 min.",
  links: {},
  ...over,
});

/** The string body of a recorded request. */
export function bodyText(init: RequestInit): string {
  return typeof init.body === "string" ? init.body : "";
}

/** Lower-cased header map of a recorded request. */
export function headerMap(init: RequestInit): Record<string, string> {
  return Object.fromEntries(new Headers(init.headers));
}
