import { describe, expect, test } from "bun:test";

import type { Availability } from "./enums.ts";
import {
  detectAccountEvents,
  readingFromCollect,
  type DetectInput,
  type Reading,
  type ReadingCredit,
  type ReadingMetric,
} from "./account-event-detection.ts";

const t0 = 1_800_000_000_000;
const minute = 60_000;
const hour = 3_600_000;

function metric(overrides: Partial<ReadingMetric> & { providerMetricKey: string }): ReadingMetric {
  return {
    kind: "quota_percentage",
    unit: "percent",
    valueNum: 0,
    availability: "available",
    unlimited: false,
    resetsAt: null,
    ...overrides,
  };
}
const credit = (id: string, usable = true, expiresAt: number | null = null): ReadingCredit => ({
  providerCreditId: id,
  usable,
  expiresAt,
});
const reading = (metrics: ReadingMetric[] = [], resetCredits: ReadingCredit[] = []): Reading => ({
  metrics,
  resetCredits,
});
const inventory = (n: number) =>
  metric({
    providerMetricKey: "reset_credits.available_count",
    kind: "reset_inventory",
    unit: "resets",
    valueNum: n,
  });

function detect(overrides: Partial<DetectInput> & Pick<DetectInput, "current">) {
  return detectAccountEvents({
    provider: "codex",
    previous: reading(),
    observedAt: t0,
    actionSincePrevious: false,
    ...overrides,
  });
}

const balance = (
  key: string,
  valueNum: number | null,
  unit: string,
  availability: Availability = "available",
) => metric({ providerMetricKey: key, kind: "credits", unit, valueNum, availability });

describe("reset_granted", () => {
  test("a new usable credit with a higher usable count fires", () => {
    const events = detect({
      previous: reading([inventory(1)], [credit("a")]),
      current: reading([inventory(2)], [credit("a"), credit("b", true, t0 + hour)]),
    });
    expect(events).toEqual([
      {
        metricKey: null,
        detail: { kind: "reset_granted", creditId: "b", expiresAt: t0 + hour, available: 2 },
      },
    ]);
  });

  test("nothing on the first reading", () => {
    expect(detect({ previous: null, current: reading([inventory(1)], [credit("a")]) })).toEqual([]);
  });

  test("a new id with no rise in the usable count does not fire", () => {
    const events = detect({
      previous: reading([inventory(1)], [credit("a")]),
      current: reading([inventory(1)], [credit("b")]),
    });
    expect(events).toEqual([]);
  });

  test("an unusable new credit does not fire", () => {
    const events = detect({
      previous: reading([inventory(0)], []),
      current: reading([inventory(0)], [credit("b", false)]),
    });
    expect(events).toEqual([]);
  });

  test("a reset inventory that was unknown before is not read as zero", () => {
    const unknown = metric({
      providerMetricKey: "reset_grants.available",
      kind: "reset_inventory",
      valueNum: null,
      availability: "unknown",
    });
    const events = detect({
      provider: "claude",
      previous: reading([unknown], []),
      current: reading([inventory(1)], [credit("grant-0", true, t0 + hour)]),
    });
    expect(events).toEqual([]);
  });

  test("a Claude list that shifted its index-derived ids does not fire without a rise", () => {
    // Grant 0 was used up and a longer grant moved into its slot: same ids, new expiry, same count.
    const events = detect({
      provider: "claude",
      previous: reading([inventory(1)], [credit("grant-0", true, t0 + hour)]),
      current: reading([inventory(1)], [credit("grant-0", true, t0 + 2 * hour)]),
    });
    expect(events).toEqual([]);
  });

  test("a Claude grant that reuses an index but is new fires when the count rose", () => {
    const events = detect({
      provider: "claude",
      previous: reading([inventory(1)], [credit("grant-0", true, t0 + hour)]),
      current: reading(
        [inventory(2)],
        [credit("grant-0", true, t0 + 2 * hour), credit("grant-1", true, t0 + hour)],
      ),
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toMatchObject({ kind: "reset_granted", creditId: "grant-0" });
  });

  test("other providers never fire", () => {
    const events = detect({
      provider: "cursor",
      previous: reading([inventory(0)], []),
      current: reading([inventory(1)], [credit("a")]),
    });
    expect(events).toEqual([]);
  });
});

describe("early_reset", () => {
  const key = "rate_limit.primary_window";
  const window = (
    valueNum: number | null,
    resetsAt: number | null,
    availability: Availability = "available",
  ) => metric({ providerMetricKey: key, valueNum, resetsAt, availability });

  test("a drop from 60 to 2 with the reset a day away fires", () => {
    const events = detect({
      previous: reading([window(60, t0 + 24 * hour)]),
      current: reading([window(2, t0 + 24 * hour)]),
    });
    expect(events).toEqual([
      {
        metricKey: key,
        detail: {
          kind: "early_reset",
          previousPercent: 60,
          percent: 2,
          expectedResetAt: t0 + 24 * hour,
        },
      },
    ]);
  });

  test("a five-hour session window that resets 2 hours early fires", () => {
    const events = detect({
      previous: reading([window(80, t0 + 2 * hour)]),
      current: reading([window(0, t0 + 5 * hour)]),
    });
    expect(events).toHaveLength(1);
  });

  test("a window that reset on time does not fire", () => {
    const events = detect({
      previous: reading([window(80, t0 - 30_000)]),
      current: reading([window(1, t0 + 5 * hour)]),
    });
    expect(events).toEqual([]);
    const near = detect({
      previous: reading([window(80, t0 + 10 * minute)]),
      current: reading([window(1, t0 + 5 * hour)]),
    });
    expect(near).toEqual([]);
  });

  test("an action that succeeded or ended uncertain since the previous reading explains the drop", () => {
    const events = detect({
      actionSincePrevious: true,
      previous: reading([window(60, t0 + 24 * hour)]),
      current: reading([window(0, t0 + 24 * hour)]),
    });
    expect(events).toEqual([]);
  });

  test("thresholds: below 10 before, above 5 after, or a drop under 10 points do not fire", () => {
    const cases: [number, number][] = [
      [9, 0],
      [60, 6],
      [14, 5.5],
    ];
    for (const [before, after] of cases) {
      expect(
        detect({
          previous: reading([window(before, t0 + 24 * hour)]),
          current: reading([window(after, t0 + 24 * hour)]),
        }),
      ).toEqual([]);
    }
    // Exactly on the edges: 10 to 0 and 15 to 5 both fire.
    for (const [before, after] of [
      [10, 0],
      [15, 5],
    ] as const) {
      expect(
        detect({
          previous: reading([window(before, t0 + 24 * hour)]),
          current: reading([window(after, t0 + 24 * hour)]),
        }),
      ).toHaveLength(1);
    }
  });

  test("an unknown or unavailable value in either reading never reads as zero", () => {
    expect(
      detect({
        previous: reading([window(60, t0 + 24 * hour)]),
        current: reading([window(null, t0 + 24 * hour, "unknown")]),
      }),
    ).toEqual([]);
    expect(
      detect({
        previous: reading([window(null, t0 + 24 * hour, "unknown")]),
        current: reading([window(0, t0 + 24 * hour)]),
      }),
    ).toEqual([]);
  });

  test("a previous reading with no reset time cannot show an early reset", () => {
    expect(
      detect({
        previous: reading([window(60, null)]),
        current: reading([window(0, t0 + 24 * hour)]),
      }),
    ).toEqual([]);
  });

  test("a banked reset that left the inventory with the drop marks it as used", () => {
    const events = detect({
      previous: reading(
        [window(60, t0 + 24 * hour), inventory(2)],
        [credit("a", true, t0 + 48 * hour), credit("b")],
      ),
      current: reading([window(0, t0 + 7 * 24 * hour), inventory(1)], [credit("b")]),
    });
    expect(events).toEqual([
      {
        metricKey: key,
        detail: {
          kind: "early_reset",
          previousPercent: 60,
          percent: 0,
          expectedResetAt: t0 + 24 * hour,
          bankedUsed: true,
        },
      },
    ]);
  });

  test("a banked reset that expired, or an inventory not reported, does not count as used", () => {
    const expired = detect({
      previous: reading([window(60, t0 + 24 * hour), inventory(1)], [credit("a", true, t0 - 1)]),
      current: reading([window(0, t0 + 24 * hour), inventory(0)]),
    });
    expect(expired).toHaveLength(1);
    expect(expired[0]?.detail).not.toHaveProperty("bankedUsed");
    const unreported = detect({
      previous: reading([window(60, t0 + 24 * hour)], [credit("a")]),
      current: reading([window(0, t0 + 24 * hour)]),
    });
    expect(unreported[0]?.detail).not.toHaveProperty("bankedUsed");
  });

  test("applies to every provider's percent limits", () => {
    const events = detect({
      provider: "cursor",
      previous: reading([window(60, t0 + 24 * hour)]),
      current: reading([window(2, t0 + 24 * hour)]),
    });
    expect(events).toHaveLength(1);
  });
});

describe("top_up_detected", () => {
  test("Codex: a rise of 1000 credits fires", () => {
    const events = detect({
      previous: reading([balance("credits.balance", 12, "codex_credits")]),
      current: reading([balance("credits.balance", 1012, "codex_credits")]),
    });
    expect(events).toEqual([
      {
        metricKey: "credits.balance",
        detail: {
          kind: "top_up_detected",
          unit: "codex_credits",
          previous: 12,
          current: 1012,
          added: 1000,
          topUpId: null,
        },
      },
    ]);
  });

  test("Grok prepaid_balance fires; a fall does not", () => {
    expect(
      detect({
        provider: "grok",
        previous: reading([balance("prepaid_balance", 5, "grok_credits")]),
        current: reading([balance("prepaid_balance", 25.5, "grok_credits")]),
      }),
    ).toHaveLength(1);
    expect(
      detect({
        provider: "grok",
        previous: reading([balance("prepaid_balance", 25, "grok_credits")]),
        current: reading([balance("prepaid_balance", 5, "grok_credits")]),
      }),
    ).toEqual([]);
  });

  test("a rise below 0.01 does not fire", () => {
    expect(
      detect({
        previous: reading([balance("credits.balance", 1, "codex_credits")]),
        current: reading([balance("credits.balance", 1.004, "codex_credits")]),
      }),
    ).toEqual([]);
    expect(
      detect({
        previous: reading([balance("credits.balance", 1, "codex_credits")]),
        current: reading([balance("credits.balance", 1.01, "codex_credits")]),
      }),
    ).toHaveLength(1);
  });

  test("an unknown balance in one reading does not fire", () => {
    expect(
      detect({
        previous: reading([balance("credits.balance", null, "codex_credits", "unknown")]),
        current: reading([balance("credits.balance", 500, "codex_credits")]),
      }),
    ).toEqual([]);
    expect(
      detect({
        previous: reading([balance("credits.balance", 500, "codex_credits")]),
        current: reading([balance("credits.balance", null, "codex_credits", "unknown")]),
      }),
    ).toEqual([]);
  });

  test("an unlimited balance does not fire", () => {
    const unlimited = { ...balance("credits.balance", 0, "codex_credits"), unlimited: true };
    expect(
      detect({
        previous: reading([unlimited]),
        current: reading([balance("credits.balance", 100, "codex_credits")]),
      }),
    ).toEqual([]);
  });

  test("Vercel: spend lowers the balance and raises total used, so the total is unchanged and nothing fires", () => {
    const events = detect({
      provider: "vercel_ai_gateway",
      previous: reading([
        balance("credits.balance", 50, "gateway_credits"),
        balance("credits.total_used", 10, "gateway_credits"),
      ]),
      current: reading([
        balance("credits.balance", 45, "gateway_credits"),
        balance("credits.total_used", 15, "gateway_credits"),
      ]),
    });
    expect(events).toEqual([]);
  });

  test("Vercel: a grant raises the granted total", () => {
    const events = detect({
      provider: "vercel_ai_gateway",
      previous: reading([
        balance("credits.balance", 45, "gateway_credits"),
        balance("credits.total_used", 15, "gateway_credits"),
      ]),
      current: reading([
        balance("credits.balance", 145, "gateway_credits"),
        balance("credits.total_used", 16, "gateway_credits"),
      ]),
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toMatchObject({
      kind: "top_up_detected",
      unit: "gateway_credits",
      previous: 60,
      current: 161,
      added: 101,
    });
  });

  test("Vercel falls back to the balance when total used is missing in either reading", () => {
    const events = detect({
      provider: "vercel_ai_gateway",
      previous: reading([balance("credits.balance", 45, "gateway_credits")]),
      current: reading([
        balance("credits.balance", 145, "gateway_credits"),
        balance("credits.total_used", 16, "gateway_credits"),
      ]),
    });
    expect(events[0]?.detail).toMatchObject({ previous: 45, current: 145, added: 100 });
  });

  test("a provider with no balance key and an unsupported unit never fires", () => {
    expect(
      detect({
        provider: "cursor",
        previous: reading([balance("credits.balance", 1, "codex_credits")]),
        current: reading([balance("credits.balance", 100, "codex_credits")]),
      }),
    ).toEqual([]);
    expect(
      detect({
        previous: reading([balance("credits.balance", 1, "points")]),
        current: reading([balance("credits.balance", 100, "points")]),
      }),
    ).toEqual([]);
  });
});

describe("readingFromCollect", () => {
  test("maps text values to numbers and keeps an empty one unknown", () => {
    const parsed = readingFromCollect({
      observedAt: t0,
      failures: [],
      metrics: [
        {
          providerMetricKey: "a",
          kind: "credits",
          scope: "account",
          valueText: "12.5",
          unit: "USD",
          availability: "available",
          interface: "private",
        },
        {
          providerMetricKey: "b",
          kind: "credits",
          scope: "account",
          valueText: "",
          unit: "USD",
          availability: "available",
          interface: "private",
        },
      ],
    });
    expect(parsed.metrics.map((m) => m.valueNum)).toEqual([12.5, null]);
  });
});
