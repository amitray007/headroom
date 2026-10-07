import { describe, expect, test } from "bun:test";

import { connection, credit, metric, percent } from "@headroom/view-model/test-fixtures";
import {
  laneGroups,
  laneOf,
  limitName,
  runningLow,
  savedResets,
  sharedNames,
  upNextGroups,
  upNextItems,
} from "./lanes.ts";

const hour = 3_600_000;
const day = 24 * hour;
const now = new Date(2025, 10, 3, 11, 0).getTime();

const claude = connection("claude", {
  id: "claude-1",
  metrics: [
    percent("five_hour", 64, { scope: "window:18000s", resetsAt: now + 2 * hour }),
    percent("seven_day", 81, { resetsAt: now + 5 * day }),
    percent("limits.Fable", 91, { resetsAt: now + 4 * day }),
  ],
});
const codex = connection("codex", {
  id: "codex-1",
  metrics: [
    percent("rate_limit.primary_window", 23, { scope: "window:604800s", resetsAt: now + 3 * day }),
    metric("reset_credits.available_count", {
      kind: "reset_inventory",
      unit: "resets",
      scope: "account",
      valueText: "3",
      valueNum: 3,
    }),
  ],
  resetCredits: [
    credit("a", { expiresAt: now + 9 * day }),
    credit("b", { expiresAt: now + 2 * day }),
    credit("c", { expiresAt: now + 20 * day }),
    credit("old", { expiresAt: now - day }),
  ],
});
const cursor = connection("cursor", {
  id: "cursor-1",
  metrics: [
    percent("included.total_percent", 40, {
      scope: "billing_cycle",
      windowStart: now - 10 * day,
      windowEnd: now + 20 * day,
      resetsAt: now + 20 * day,
    }),
  ],
});
const vercel = connection("vercel_ai_gateway", { id: "vercel-1" });

describe("laneOf", () => {
  test("draws the window with the most used, from its start to its reset", () => {
    const lane = laneOf(claude, "weekly", now);
    expect(lane?.phase).toBe("current");
    expect(lane?.used).toBe(91);
    expect(lane?.drawn.key).toBe("limits.Fable");
    expect(lane?.end).toBe(now + 4 * day);
    expect(lane?.start).toBe(now - 3 * day);
    expect(lane?.lengthMs).toBe(7 * day);
    expect(lane?.meters).toHaveLength(2);
  });
  test("an account without a window of the kind has no lane", () => {
    expect(laneOf(codex, "session", now)).toBeNull();
    expect(laneOf(vercel, "weekly", now)).toBeNull();
    expect(laneOf(vercel, "cycle", now)).toBeNull();
    expect(laneOf(claude, "cycle", now)).toBeNull();
  });
  test("a cycle lane spans the reported window", () => {
    const lane = laneOf(cursor, "cycle", now);
    expect(lane?.start).toBe(now - 10 * day);
    expect(lane?.end).toBe(now + 20 * day);
  });
  test("a session that has not started is an idle window from now", () => {
    const idle = connection("claude", {
      metrics: [percent("five_hour", 0, { scope: "window:18000s", resetsAt: null })],
    });
    const lane = laneOf(idle, "session", now);
    expect(lane).toMatchObject({ phase: "idle", used: null, start: now, end: now + 5 * hour });
  });
  test("a window that closed before now is ended, not current", () => {
    const old = connection("claude", {
      state: "paused",
      metrics: [percent("seven_day", 50, { resetsAt: now - day })],
    });
    const lane = laneOf(old, "weekly", now);
    expect(lane?.phase).toBe("ended");
    expect(lane?.inactive).toBe(true);
  });
  test("banked resets are the Codex credits still ahead, soonest first", () => {
    const lane = laneOf(codex, "weekly", now);
    expect(lane?.banks.map((bank) => [bank.index, bank.at - now, bank.count, bank.label])).toEqual([
      [0, 2 * day, 3, "Reset Credit"],
      [1, 9 * day, 3, "Reset Credit"],
      [2, 20 * day, 3, "Reset Credit"],
    ]);
  });
});

describe("laneGroups", () => {
  test("follows the saved provider order and leaves out accounts with nothing to draw", () => {
    const groups = laneGroups([claude, codex, cursor, vercel], ["codex", "claude"], "weekly", now);
    expect(groups.map((group) => group.provider)).toEqual(["codex", "claude"]);
    expect(groups[0]?.lanes.map((lane) => lane.id)).toEqual(["codex-1:weekly"]);
  });
});

describe("limitName", () => {
  test("a model window is named by the model", () => {
    expect(limitName({ label: "Weekly", window: "Fable" })).toBe("Fable");
    expect(limitName({ label: "Weekly", window: "all models" })).toBe("Weekly");
    expect(limitName({ label: "Weekly", window: "7 days" })).toBe("Weekly");
    expect(limitName({ label: "Session", window: "5 hours" })).toBe("Session");
    expect(limitName({ label: "Included", window: null })).toBe("Included");
  });
});

describe("upNext", () => {
  const items = upNextItems([claude, codex, cursor, vercel], now);
  test("lists open windows in reset order, one per account and kind", () => {
    expect(items.map((item) => [item.id, (item.end - now) / hour])).toEqual([
      ["claude-1:session", 2],
      ["codex-1:weekly", 72],
      ["claude-1:weekly", 96],
      ["cursor-1:cycle", 480],
    ]);
  });
  test("a session that has not started does not reset", () => {
    const idle = connection("claude", {
      metrics: [percent("five_hour", 0, { scope: "window:18000s", resetsAt: null })],
    });
    expect(upNextItems([idle], now)).toEqual([]);
  });
  test("groups by how far off the reset is", () => {
    const groups = upNextGroups(items, now, null);
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ["Next 24 Hours", 1],
      ["This Week", 2],
      ["Later", 1],
    ]);
  });
  test("a limit keeps the first rows overall and drops empty groups", () => {
    const groups = upNextGroups(items, now, 2);
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([
      ["Next 24 Hours", 1],
      ["This Week", 1],
    ]);
  });
});

describe("runningLow", () => {
  test("windows at or past the warn threshold, the most used first, with when room returns", () => {
    const rows = runningLow([claude, codex], now, 30);
    expect(rows.map((row) => [row.meter.key, row.tone, row.caption, row.back - now])).toEqual([
      ["limits.Fable", "bad", "Almost Out", 4 * day],
      ["seven_day", "warn", "Running Low", 5 * day],
    ]);
  });
  test("the threshold setting moves the line", () => {
    expect(runningLow([claude], now, 15).map((row) => row.meter.key)).toEqual(["limits.Fable"]);
  });
  test("an unknown figure is not running low", () => {
    const unknown = connection("claude", {
      metrics: [metric("seven_day", { availability: "unknown", resetsAt: now + day })],
    });
    expect(runningLow([unknown], now, 30)).toEqual([]);
  });
});

describe("savedResets", () => {
  test("accounts with banked resets, earliest expiry first, soon flagged under three days", () => {
    const grants = connection("claude", {
      id: "claude-2",
      metrics: [
        metric("reset_grants.available", {
          kind: "reset_inventory",
          unit: "resets",
          scope: "account",
          valueText: "1",
          valueNum: 1,
        }),
      ],
      resetCredits: [credit("g", { expiresAt: now + 10 * day })],
    });
    const rows = savedResets([grants, codex, claude], now);
    expect(rows.map((row) => [row.connection.id, row.count, row.soon, row.label])).toEqual([
      ["codex-1", 3, true, "Reset Credit"],
      ["claude-2", 1, false, "Reset Grant"],
    ]);
    expect(rows[0]?.expiries.map((at) => (at - now) / day)).toEqual([2, 9, 20]);
  });
});

/** A Codex account with no name of its own, so it reads "Personal". */
const personal = (id: string, identity: string | null) =>
  connection("codex", { id, identity, name: null });

describe("sharedNames", () => {
  test("marks accounts of one provider that share a name, and only those with an identity", () => {
    const named = connection("codex", { id: "named", name: "Work" });
    const other = connection("claude", { id: "claude-p", name: null });
    const shared = sharedNames([
      personal("a", "one@example.com"),
      personal("b", "two@example.com"),
      personal("c", null),
      named,
      other,
    ]);
    expect([...shared].toSorted()).toEqual(["a", "b"]);
  });
});
