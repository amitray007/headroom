import { describe, expect, test } from "bun:test";

import { earlyResetLine, earlyResetsOf, type EarlyReset } from "./early-resets.ts";
import type { AccountEvent } from "@headroom/core/contracts";

const now = 1_800_000_000_000;
const hour = 3_600_000;
const day = 24 * hour;

const early = (id: string, metricKey: string, at: number, bankedUsed = false): AccountEvent => ({
  id,
  connectionId: "c1",
  occurredAt: at,
  metricKey,
  detail: {
    kind: "early_reset",
    previousPercent: 64,
    percent: 2,
    expectedResetAt: at + 2 * day,
    ...(bankedUsed ? { bankedUsed: true as const } : {}),
  },
});

describe("early resets", () => {
  test("lists only early resets, newest first, with the banked mark", () => {
    const granted: AccountEvent = {
      id: "g",
      connectionId: "c1",
      occurredAt: now,
      metricKey: null,
      detail: { kind: "reset_granted", creditId: "a", expiresAt: null, available: 1 },
    };
    const resets = earlyResetsOf({
      events: [
        early("old", "seven_day", now - 3 * day),
        granted,
        early("new", "seven_day", now - hour, true),
      ],
    });
    expect(resets.map((reset) => [reset.id, reset.bankedUsed])).toEqual([
      ["new", true],
      ["old", false],
    ]);
  });

  test("one line of figures in the used or left view", () => {
    const reset: EarlyReset = {
      id: "e",
      metricKey: "seven_day",
      at: now - hour,
      from: 63.6,
      to: 2.4,
      expectedAt: now + day,
      bankedUsed: true,
    };
    expect(earlyResetLine(reset, "used")).toBe("64% → 2% used · 1 day 1 h early");
    expect(earlyResetLine(reset, "left")).toBe("36% → 98% left · 1 day 1 h early");
  });
});
