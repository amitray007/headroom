import { describe, expect, test } from "bun:test";

import type { z } from "zod";

import type { PlanFit } from "@headroom/view-model/analytics";
import type { appFeedSchema } from "@headroom/view-model/app-feed";

import { formatHistory, formatStatus } from "./format.ts";

const now = Date.UTC(2026, 9, 29, 12);
const hour = 3_600_000;

type FeedAccount = z.infer<typeof appFeedSchema>["accounts"][number];
type Feed = z.infer<typeof appFeedSchema>;

const limit = (
  over: Partial<FeedAccount["limits"][number]> = {},
): FeedAccount["limits"][number] => ({
  key: "weekly",
  label: "weekly",
  window: null,
  windowKind: "weekly",
  percentLeft: 30,
  unlimited: false,
  notStarted: false,
  resetsAt: now + 76 * hour,
  resetWords: "resets",
  runsOutAt: null,
  part: false,
  interface: "private",
  ...over,
});

const account = (over: Partial<FeedAccount> = {}): FeedAccount => ({
  id: "a1",
  provider: "claude",
  name: "Work",
  plan: "Max",
  identity: null,
  state: "ready",
  reconnectReason: null,
  interface: "private",
  lastSuccessAt: now - hour,
  observedAt: now - hour,
  limits: [],
  charges: [],
  banked: null,
  ...over,
});

const feed = (accounts: FeedAccount[], summary: Partial<Feed["summary"]> = {}): Feed => ({
  apiVersion: 1,
  serverVersion: "0.0.0",
  generatedAt: now,
  refreshIntervalMs: 900_000,
  staleAfterMs: 3 * hour,
  dashboardUrl: null,
  providerOrder: ["claude"],
  accounts,
  summary: { monthlyPlanTotal: null, extraSpend: [], nextLimitBack: null, ...summary },
  notices: [],
});

describe("formatStatus", () => {
  test("prints each limit variant, charge, banked line and footers", () => {
    const text = formatStatus(
      feed(
        [
          account({
            limits: [
              limit({ key: "session", label: "5h", percentLeft: 62, resetsAt: now + 130 * 60_000 }),
              limit({ runsOutAt: now + 26 * hour }),
              limit({ label: "opus", unlimited: true }),
              limit({ label: "design", notStarted: true, percentLeft: 100 }),
              limit({ label: "extra", percentLeft: null }),
            ],
            charges: [
              {
                key: "c",
                label: "credits",
                kind: "balance",
                value: 12.4,
                unit: "usd",
                cap: { value: 50, unit: "usd" },
                window: null,
                unlimited: false,
                availability: "available",
                interface: "private",
              },
              {
                key: "d",
                label: "spend",
                kind: "spend",
                value: null,
                unit: "usd",
                cap: null,
                window: null,
                unlimited: false,
                availability: "available",
                interface: "private",
              },
            ],
            banked: {
              count: 2,
              unit: "resets",
              expiries: [now - hour, now + 5 * 24 * hour, now + 9 * 24 * hour],
              interface: "private",
            },
          }),
        ],
        {
          monthlyPlanTotal: { minor: 12000, currency: "USD" },
          nextLimitBack: { accountId: "a1", metricKey: "weekly", at: now + 2 * hour },
        },
      ),
    );
    expect(text).toBe(
      [
        "claude · Work (Max) · private API",
        "  5h: 62% left, resets in 2 h 10 min",
        "  weekly: 30% left, resets in 3 days 4 h, runs out in 1 day 2 h at current pace",
        "  opus: unlimited",
        "  design: not started",
        "  extra: unknown",
        "  credits: 12.4 usd of 50 usd cap",
        "  spend: unknown",
        "  banked: 2 resets, next expires in 5 days",
        "plans: $120/month",
        "next limit back: Work weekly in 2 h",
      ].join("\n"),
    );
  });

  test("says a passed reset is due instead of counting down to it", () => {
    const text = formatStatus(
      feed([
        account({
          limits: [
            limit({ resetsAt: now - hour, runsOutAt: now - 2 * hour }),
            limit({ key: "cycle", label: "cycle", resetWords: "cycle_end", resetsAt: now - hour }),
          ],
        }),
      ]),
    );
    expect(text).toBe(
      [
        "claude · Work (Max) · private API",
        "  weekly: 30% left, reset due, not read since",
        "  cycle: 30% left, cycle ended, not read since",
      ].join("\n"),
    );
  });

  test("marks a private metric on an official account", () => {
    const text = formatStatus(
      feed([
        account({
          interface: "official",
          limits: [limit(), limit({ key: "auto", label: "auto", interface: "official" })],
        }),
      ]),
    );
    expect(text).toBe(
      [
        "claude · Work (Max)",
        "  weekly (private): 30% left, resets in 3 days 4 h",
        "  auto: 30% left, resets in 3 days 4 h",
      ].join("\n"),
    );
  });

  test("marks a stale reading and a reconnect with the last read time", () => {
    const text = formatStatus(
      feed([
        account({ observedAt: now - 5 * hour, lastSuccessAt: now - 5 * hour, limits: [limit()] }),
        account({
          provider: "codex",
          name: "Spare",
          plan: null,
          state: "reconnect_required",
          reconnectReason: "refresh_rejected",
          observedAt: now - 3 * hour,
        }),
      ]),
    );
    expect(text).toBe(
      [
        "claude · Work (Max) · private API · last read 5 h ago",
        "  weekly: 30% left, resets in 3 days 4 h",
        "codex · Spare · private API · reconnect required (refresh_rejected) · last read 3 h ago",
      ].join("\n"),
    );
  });

  test("filters by provider and says so when none match", () => {
    const f = feed([account()]);
    expect(formatStatus(f, "claude")).toBe("claude · Work (Max) · private API");
    expect(formatStatus(f, "grok")).toBe("no grok accounts");
    expect(formatStatus(feed([]))).toBe("no accounts");
  });
});

type Model = Parameters<typeof formatHistory>[0];

const story = (id: string, plan: string | null = "Max"): Model["accounts"][number] => ({
  id,
  provider: "claude",
  name: "Work",
  plan,
});

const fit = (over: Partial<PlanFit> = {}): PlanFit => ({
  unit: "week",
  windows: [],
  hits: 0,
  average: 50,
  highest: 60,
  lockedHours: 0,
  unusedUsd: null,
  verdict: "fits",
  ...over,
});

const windowOf = (peak: number, over: { hit?: boolean; early?: boolean } = {}) => ({
  start: 0,
  end: 1,
  peak,
  hours: 0,
  hit: over.hit ?? false,
  early: over.early ?? false,
});

const analytics = (stories: Model["accounts"], coverageDays: number | null): Model => ({
  accounts: stories,
  history: { coverageDays, empty: coverageDays === null },
});

describe("formatHistory", () => {
  test("marks hits and early resets with a legend, and omits unknown cost", () => {
    const text = formatHistory(
      analytics([story("a")], 20),
      new Map([
        [
          "a",
          fit({
            windows: [windowOf(64), windowOf(100, { hit: true }), windowOf(71, { early: true })],
            hits: 1,
            average: 78,
            highest: 100,
            lockedHours: 6,
          }),
        ],
      ]),
      30,
    );
    expect(text).toBe(
      [
        "last 30 days, history covers 20 days",
        "marks: ! hit the limit, ↺ reset early",
        "claude · Work (Max) weekly: 3 windows, avg peak 78%, max 100%, hit limit 1x (6 h locked), fit: fits",
        "  peaks: 64 100! 71↺",
      ].join("\n"),
    );
  });

  test("prints thin history as not enough history, with no legend or hit clause", () => {
    const text = formatHistory(
      analytics([story("a", null)], 3),
      new Map([
        ["a", fit({ unit: "month", windows: [windowOf(40)], verdict: "thin", unusedUsd: 12.4 })],
      ]),
      7,
    );
    expect(text).toBe(
      [
        "last 7 days, history covers 3 days",
        "claude · Work monthly: 1 window, avg peak 50%, max 60%, fit: not enough history, ~$12/month unused",
        "  peaks: 40",
      ].join("\n"),
    );
  });

  test("says when there is no history or no closed window", () => {
    expect(formatHistory(analytics([], null), new Map(), 30)).toBe("last 30 days, no history yet");
    expect(formatHistory(analytics([story("a")], 5), new Map(), 30)).toBe(
      "last 30 days, history covers 5 days\nclaude · Work (Max): no closed windows yet",
    );
  });
});
