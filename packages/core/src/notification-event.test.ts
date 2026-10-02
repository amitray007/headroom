import { describe, expect, test } from "bun:test";

import { notificationKinds } from "./enums.ts";
import { notificationEventSchema, type NotificationEvent } from "./notification-event.ts";

const event = (over: Partial<NotificationEvent> = {}): NotificationEvent => ({
  schemaVersion: 1,
  id: "conn-1:running_low:seven_day:1790000000000",
  kind: "running_low",
  tone: "warn",
  occurredAt: 1_789_990_000_000,
  observedAt: 1_789_990_000_000,
  provider: "claude",
  connection: { id: "conn-1", name: "Personal", plan: "max_5x" },
  subject: { metricKey: "seven_day", label: "Weekly", window: "all models" },
  figures: { percentUsed: 78, percentLeft: 22, resetsAt: 1_790_000_000_000 },
  title: "Claude Weekly Limit Is Running Low",
  message: "78% used. Resets in 52 min.",
  links: {},
  ...over,
});

describe("notification event", () => {
  test("a synthetic event for every kind parses", () => {
    for (const kind of notificationKinds) {
      expect(notificationEventSchema.safeParse(event({ kind })).success).toBe(true);
    }
  });

  test("amounts carry an explicit unit, and an unknown unit is rejected", () => {
    const usd = event({
      kind: "spend_near_cap",
      figures: { amount: { value: 35, unit: "USD" }, cap: { value: 50, unit: "USD" } },
    });
    expect(notificationEventSchema.safeParse(usd).success).toBe(true);
    const bad = { ...usd, figures: { amount: { value: 35, unit: "dollars" } } };
    expect(notificationEventSchema.safeParse(bad).success).toBe(false);
    expect(
      notificationEventSchema.safeParse({ ...usd, figures: { amount: { value: 35 } } }).success,
    ).toBe(false);
  });

  test("identity is optional, non-empty, and absent by default", () => {
    expect(notificationEventSchema.safeParse(event()).success).toBe(true);
    const base = event().connection;
    const withIdentity = event({ connection: { ...base, identity: "owner@example.com" } });
    expect(notificationEventSchema.safeParse(withIdentity).success).toBe(true);
    const empty = event({ connection: { ...base, identity: "" } });
    expect(notificationEventSchema.safeParse(empty).success).toBe(false);
  });

  test("figures may be empty, because an unknown figure is left out", () => {
    expect(notificationEventSchema.safeParse(event({ figures: {} })).success).toBe(true);
  });

  test("the version is fixed at 1 and the kind must be known", () => {
    expect(notificationEventSchema.safeParse({ ...event(), schemaVersion: 2 }).success).toBe(false);
    expect(notificationEventSchema.safeParse({ ...event(), kind: "mystery" }).success).toBe(false);
  });

  test("the only identifier field is the optional connection.identity", () => {
    const withEmail = { ...event(), connection: { ...event().connection, email: "a@example.com" } };
    expect(notificationEventSchema.safeParse(withEmail).success).toBe(false);
    expect(
      notificationEventSchema.safeParse({ ...event(), identity: "a@example.com" }).success,
    ).toBe(false);
    const names = Object.keys(notificationEventSchema.shape).concat(
      Object.keys(notificationEventSchema.shape.connection.shape),
    );
    expect(names.filter((name) => /mail|login|identity|user|token|secret/i.test(name))).toEqual([
      "identity",
    ]);
  });

  test("the dashboard link must be a URL", () => {
    expect(
      notificationEventSchema.safeParse(
        event({ links: { dashboard: "https://headroom.example/" } }),
      ).success,
    ).toBe(true);
    expect(notificationEventSchema.safeParse(event({ links: { dashboard: "nope" } })).success).toBe(
      false,
    );
  });
});
