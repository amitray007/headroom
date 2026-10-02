import { describe, expect, test } from "bun:test";

import { isInactive, meterWindows, roomOf, urgencyRank } from "./accounts.ts";
import { connection, metric, percent } from "./test-fixtures.ts";

const hourMs = 3_600_000;
const dayMs = 24 * hourMs;
const noon = Date.UTC(2025, 9, 2, 12, 0);

describe("isInactive", () => {
  test("paused and reconnect_required are inactive", () => {
    expect(isInactive(connection("claude", { state: "paused" }))).toBe(true);
    expect(isInactive(connection("claude", { state: "reconnect_required" }))).toBe(true);
    expect(isInactive(connection("claude", { state: "ready" }))).toBe(false);
    expect(isInactive(connection("claude", { state: "partial" }))).toBe(false);
  });
});

const monthSeconds = (resetsAt: number): number | null =>
  meterWindows(
    connection("copilot", {
      metrics: [percent("credits.used_percent", 1, { scope: "month", resetsAt })],
    }),
  )[0]?.seconds ?? null;

describe("meterWindows", () => {
  test("a session window ends at its reset and started five hours before", () => {
    const [session] = meterWindows(
      connection("claude", {
        metrics: [percent("five_hour", 20, { scope: "window:18000s", resetsAt: noon })],
      }),
    );
    expect(session).toMatchObject({
      key: "five_hour",
      seconds: 18_000,
      start: noon - 5 * hourMs,
      end: noon,
      kind: "session",
    });
  });
  test("weekly by name and by seconds, with a reported start winning over the computed one", () => {
    const reportedStart = noon - 6 * dayMs;
    const windows = meterWindows(
      connection("grok", {
        metrics: [
          percent("weekly_pool.used_percent", 10, { scope: "window:weekly", resetsAt: noon }),
          percent("product.grok_chat.used_percent", 5, {
            scope: "window:604800s",
            resetsAt: noon,
            windowStart: reportedStart,
          }),
        ],
      }),
    );
    expect(windows.map((w) => [w.key, w.seconds, w.kind, w.start])).toEqual([
      ["weekly_pool.used_percent", 604_800, "weekly", noon - 7 * dayMs],
      ["product.grok_chat.used_percent", 604_800, "weekly", reportedStart],
    ]);
  });
  test("a month is the calendar month before the reset", () => {
    expect(monthSeconds(Date.UTC(2025, 2, 1))).toBe(28 * 86_400);
    expect(monthSeconds(Date.UTC(2025, 3, 15))).toBe(31 * 86_400);
    // 31 March has no 31 February: the month starts on 28 February.
    expect(monthSeconds(Date.UTC(2025, 2, 31))).toBe(31 * 86_400);
    expect(monthSeconds(Date.UTC(2025, 0, 10))).toBe(31 * 86_400);
  });
  test("a month with no reset has no length or start", () => {
    const [window] = meterWindows(
      connection("copilot", {
        metrics: [percent("credits.used_percent", 1, { scope: "month" })],
      }),
    );
    expect(window).toMatchObject({ seconds: null, start: null, end: null, kind: "cycle" });
  });
  test("a billing cycle takes its length from the reported window", () => {
    const start = Date.UTC(2025, 8, 26, 10);
    const end = Date.UTC(2025, 9, 26, 10);
    const [window] = meterWindows(
      connection("cursor", {
        metrics: [
          percent("included.total_percent", 17, {
            scope: "billing_cycle",
            windowStart: start,
            windowEnd: end,
            resetsAt: end,
          }),
        ],
      }),
    );
    expect(window).toMatchObject({ seconds: 30 * 86_400, start, end, kind: "cycle" });
  });
  test("a daily or unscoped window is other", () => {
    const windows = meterWindows(
      connection("codex", {
        metrics: [
          percent("rate_limit.primary_window", 1, { scope: "window:86400s", resetsAt: noon }),
          percent("rate_limit.secondary_window", 1, { scope: "window", resetsAt: noon }),
        ],
      }),
    );
    expect(windows.map((w) => [w.seconds, w.kind, w.start])).toEqual([
      [86_400, "other", noon - dayMs],
      [null, "other", null],
    ]);
  });
  test("a session that has not started has no reset and is marked so", () => {
    const [session] = meterWindows(
      connection("claude", {
        metrics: [percent("five_hour", 0, { scope: "window:18000s", resetsAt: null })],
      }),
    );
    expect(session).toMatchObject({ notStarted: true, end: null, start: null, seconds: 18_000 });
  });
  test("accounts with no meters have no windows", () => {
    expect(meterWindows(connection("claude", { snapshot: null }))).toEqual([]);
  });
});

describe("roomOf", () => {
  test("Claude: the tightest of session, weekly and model windows", () => {
    const room = roomOf(
      connection("claude", {
        metrics: [
          percent("five_hour", 30, { scope: "window:18000s", resetsAt: noon }),
          percent("seven_day", 60),
          percent("limits.Opus", 85),
        ],
      }),
    );
    expect(room.left).toBe(15);
    expect(room.unit).toBe("percent");
    expect(room.limiting?.key).toBe("limits.Opus");
    expect(room.windows.map((w) => w.key)).toEqual(["five_hour", "seven_day", "limits.Opus"]);
  });
  test("a session that has not started counts as full", () => {
    const only = roomOf(
      connection("claude", {
        metrics: [percent("five_hour", 0, { scope: "window:18000s", resetsAt: null })],
      }),
    );
    expect(only.left).toBe(100);
    expect(only.limiting?.notStarted).toBe(true);
    const withWeekly = roomOf(
      connection("claude", {
        metrics: [
          percent("five_hour", 0, { scope: "window:18000s", resetsAt: null }),
          percent("seven_day", 90),
        ],
      }),
    );
    expect(withWeekly.left).toBe(10);
    expect(withWeekly.limiting?.key).toBe("seven_day");
  });
  test("unknown windows are skipped, not counted as empty; over the limit is zero left", () => {
    const unknownFirst = roomOf(
      connection("claude", {
        metrics: [metric("five_hour", { availability: "unknown" }), percent("seven_day", 40)],
      }),
    );
    expect(unknownFirst.left).toBe(60);
    expect(roomOf(connection("claude", { metrics: [percent("seven_day", 120)] })).left).toBe(0);
    const none = roomOf(
      connection("claude", { metrics: [metric("seven_day", { availability: "unknown" })] }),
    );
    expect(none).toMatchObject({ left: null, limiting: null });
  });
  test("Codex: core and additional windows", () => {
    const room = roomOf(
      connection("codex", {
        metrics: [
          percent("rate_limit.primary_window", 20, { scope: "window:18000s", resetsAt: noon }),
          percent("rate_limit.secondary_window", 45, { scope: "window:604800s", resetsAt: noon }),
          percent("additional.spark.primary_window", 70, {
            scope: "window:18000s",
            resetsAt: noon,
          }),
        ],
      }),
    );
    expect(room.left).toBe(30);
    expect(room.limiting?.key).toBe("additional.spark.primary_window");
  });
  test("Cursor counts Included only, Grok the Weekly Pool only", () => {
    const cursor = roomOf(
      connection("cursor", {
        metrics: [
          percent("included.total_percent", 45, { scope: "billing_cycle" }),
          percent("included.auto_percent", 90, { scope: "billing_cycle" }),
        ],
      }),
    );
    expect([cursor.left, cursor.windows.length]).toEqual([55, 1]);
    const grok = roomOf(
      connection("grok", {
        metrics: [
          percent("weekly_pool.used_percent", 20, { scope: "window:weekly" }),
          percent("product.grok_code.used_percent", 95, { scope: "window:weekly" }),
        ],
      }),
    );
    expect([grok.left, grok.limiting?.key]).toEqual([80, "weekly_pool.used_percent"]);
  });
  test("Antigravity and Copilot: the tightest of all their windows", () => {
    const antigravity = roomOf(
      connection("antigravity", {
        metrics: [
          percent("quota.gemini-5h", 70, { scope: "window:18000s", resetsAt: noon }),
          percent("quota.3p-weekly", 25, { scope: "window:604800s" }),
        ],
      }),
    );
    expect(antigravity.left).toBe(30);
    const copilot = roomOf(
      connection("copilot", {
        metrics: [percent("credits.used_percent", 35, { scope: "month", resetsAt: noon })],
      }),
    );
    expect(copilot.left).toBe(65);
  });
  test("Vercel: balance as a percent of everything granted, else the balance itself", () => {
    const gateway = { kind: "credits", unit: "gateway_credits", scope: "team" } as const;
    const credits = (key: string, value: number) =>
      metric(key, { ...gateway, valueText: String(value), valueNum: value });
    const known = roomOf(
      connection("vercel_ai_gateway", {
        metrics: [credits("credits.balance", 30), credits("credits.total_used", 70)],
      }),
    );
    expect([known.left, known.unit, known.limiting, known.windows]).toEqual([
      30,
      "percent",
      null,
      [],
    ]);
    const balanceOnly = roomOf(
      connection("vercel_ai_gateway", { metrics: [credits("credits.balance", 12.5)] }),
    );
    expect([balanceOnly.left, balanceOnly.unit]).toEqual([12.5, "credits"]);
    expect(roomOf(connection("vercel_ai_gateway", { metrics: [] })).left).toBeNull();
  });
});

const withUsed = (used: number) => connection("claude", { metrics: [percent("seven_day", used)] });

const rank = (used: number): number => urgencyRank(withUsed(used), 30);

describe("urgencyRank", () => {
  test("lower is more urgent: bad, then warn, then good", () => {
    expect(rank(95)).toBeLessThan(rank(80));
    expect(rank(80)).toBeLessThan(rank(10));
  });
  test("within a tone the most used comes first", () => {
    expect(rank(99)).toBeLessThan(rank(92));
    expect(rank(75)).toBeLessThan(rank(71));
    expect(rank(50)).toBeLessThan(rank(5));
  });
  test("the owner's threshold moves the warn line", () => {
    // 80% used is 20% left: running low at a 30 threshold, still good at 15.
    expect(urgencyRank(withUsed(80), 30)).toBeLessThan(urgencyRank(withUsed(80), 15));
    expect(urgencyRank(withUsed(88), 15)).toBeLessThan(urgencyRank(withUsed(80), 15));
  });
  test("an account with no known room sorts last", () => {
    const unknown = connection("claude", {
      metrics: [metric("seven_day", { availability: "unknown" })],
    });
    expect(urgencyRank(unknown, 30)).toBeGreaterThan(rank(0));
  });
});
