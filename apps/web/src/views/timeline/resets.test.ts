import { describe, expect, test } from "bun:test";

import type { AccountEvent } from "@headroom/core/contracts";
import { connection, percent } from "@headroom/view-model/test-fixtures";
import { resetRows, type ResetWords } from "./resets.ts";

const hour = 3_600_000;
const day = 24 * hour;
const now = new Date(2025, 10, 3, 11, 0).getTime();
const words: ResetWords = { now, clock: "24h", view: "used" };

const event = (
  id: string,
  at: number,
  metricKey: string | null,
  detail: AccountEvent["detail"],
): AccountEvent => ({ id, connectionId: "x", occurredAt: at, metricKey, detail });

const codex = connection("codex", {
  id: "codex-1",
  metrics: [
    percent("rate_limit.primary_window", 23, { scope: "window:604800s", resetsAt: now + 3 * day }),
  ],
  events: [
    event("e", now - hour, "rate_limit.primary_window", {
      kind: "early_reset",
      previousPercent: 63.6,
      percent: 1,
      expectedResetAt: now + day,
    }),
    event("a", now - 2 * day, "rate_limit.primary_window", {
      kind: "auto_reset",
      actionId: "act",
      state: "failed",
      creditId: "c",
      percent: 96,
      resetsAt: now,
    }),
    event("t", now - 3 * hour, "credits.balance", {
      kind: "top_up_detected",
      unit: "codex_credits",
      previous: 1,
      current: 2,
      added: 1,
      topUpId: null,
    }),
  ],
});
const claude = connection("claude", {
  id: "claude-1",
  metrics: [percent("seven_day", 10, { resetsAt: now + 5 * day })],
  events: [
    event("g", now - 2 * hour, null, {
      kind: "reset_granted",
      creditId: "g1",
      expiresAt: null,
      available: 2,
    }),
    event("b", now - 3 * day, "seven_day", {
      kind: "early_reset",
      previousPercent: 78,
      percent: 1,
      expectedResetAt: now,
      bankedUsed: true,
    }),
  ],
});

describe("resetRows", () => {
  test("lists resets the owner did not start, newest first, and leaves out top-ups", () => {
    const rows = resetRows([codex, claude], words);
    expect(rows.map((row) => [row.id, row.mark, row.limit, row.what, row.change])).toEqual([
      ["e", "early", "Weekly", "Reset early", "64% → 1% used"],
      ["g", "bank", "Reset Grants", "New reset grant", "2 available"],
      ["a", "bad", "Weekly", "Auto-reset failed", "At 96% used"],
      ["b", "bank", "Weekly", "Banked reset used outside Headroom", "78% → 1% used"],
    ]);
    expect(rows[0]?.detail).toBe("1 day 1 h early");
    expect(rows[1]?.detail).toBeNull();
  });

  test("follows the left view", () => {
    const [row] = resetRows([codex], { ...words, view: "left" });
    expect(row?.change).toBe("36% → 99% left");
  });
});
