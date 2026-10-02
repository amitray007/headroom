import { describe, expect, test } from "bun:test";

import {
  currentIds,
  deriveNotifications,
  loadRead,
  markAllRead,
  markRead,
  pruneRead,
  readKey,
  saveRead,
} from "./notifications.ts";
import { defaultSettings } from "./settings-store.ts";
import { connection, credit, percent } from "./test-fixtures.ts";

const now = new Date(2025, 9, 2, 14, 14).getTime();
const reset = new Date(2025, 9, 2, 15, 6).getTime();

const claude = connection("claude", {
  id: "c1",
  observedAt: now - 720_000,
  metrics: [
    percent("seven_day", 78, { resetsAt: reset }),
    percent("limits.Fable", 91, { resetsAt: reset }),
    percent("five_hour", 20, { scope: "window:18000s", resetsAt: reset }),
  ],
});

describe("limit notifications", () => {
  const found = deriveNotifications([claude], defaultSettings, now);
  test("wording follows the approved mockup, worst first", () => {
    expect(found.map((n) => [n.tone, n.title, n.description])).toEqual([
      ["bad", "Claude Is Almost Out of Its Weekly Fable Limit", "91% used. Resets in 52 min."],
      ["warn", "Claude Weekly Limit Is Running Low", "78% used. Resets in 52 min."],
    ]);
    expect(found[0]?.kind).toBe("almost_out");
    expect(found[1]?.at).toBe(now - 720_000);
  });
  test("ids carry the connection, kind, metric and reset instant", () => {
    expect(found[1]?.id).toBe(`c1:running_low:seven_day:${reset}`);
    const next = deriveNotifications(
      [
        connection("claude", {
          id: "c1",
          metrics: [percent("seven_day", 78, { resetsAt: reset + 7 * 86_400_000 })],
        }),
      ],
      defaultSettings,
      now,
    );
    expect(next[0]?.id).not.toBe(found[1]?.id);
  });
  test("a lower threshold hides the amber one", () => {
    const strict = { ...defaultSettings, lowThresholdPercent: 15 } as const;
    expect(deriveNotifications([claude], strict, now).map((n) => n.kind)).toEqual(["almost_out"]);
  });
  test("left view and exact time", () => {
    const style = { ...defaultSettings, limitsView: "left", timeStyle: "exact" } as const;
    expect(deriveNotifications([claude], style, now)[1]?.description).toBe(
      "22% left. Resets at 15:06.",
    );
  });
  test("running low can be switched off, the other kinds stay", () => {
    const off = {
      ...defaultSettings,
      notifications: { ...defaultSettings.notifications, runningLow: false },
    };
    expect(deriveNotifications([claude], off, now)).toEqual([]);
    expect(currentIds([claude], off, now).size).toBe(2);
  });
  test("unlimited, unknown and paused accounts stay quiet", () => {
    const quiet = [
      connection("copilot", {
        metrics: [percent("credits.used_percent", 0, { unlimited: true })],
      }),
      connection("claude", { metrics: [percent("seven_day", 99)], state: "paused" }),
    ];
    expect(deriveNotifications(quiet, defaultSettings, now)).toEqual([]);
  });
});

describe("expiring resets", () => {
  const expires = new Date(2025, 9, 5, 6, 25).getTime();
  const codex = connection("codex", {
    id: "x1",
    resetCredits: [
      credit("a", { expiresAt: expires }),
      credit("b", { expiresAt: new Date(2025, 9, 22).getTime() }),
      credit("c", { expiresAt: new Date(2025, 9, 29).getTime() }),
      credit("gone", { usable: false, expiresAt: expires }),
    ],
  });
  test("one notice for the soonest, counting the bank", () => {
    const [item] = deriveNotifications([codex], defaultSettings, now);
    expect(item).toEqual(
      expect.objectContaining({
        tone: "info",
        kind: "reset_expiring",
        title: "A Codex Reset Expires in 3 Days",
        description: "1 of 3 banked full resets expires Oct 5.",
        id: `x1:reset_expiring:a:${expires}`,
      }),
    );
  });
  test("several soon", () => {
    const two = connection("codex", {
      resetCredits: [
        credit("a", { expiresAt: expires }),
        credit("b", { expiresAt: expires + 3_600_000 }),
      ],
    });
    expect(deriveNotifications([two], defaultSettings, now)[0]?.description).toBe(
      "2 of 2 banked full resets expire from Oct 5.",
    );
  });
  test("under a day reads 1 Day; beyond three days is quiet; the switch works", () => {
    const tomorrow = connection("claude", {
      resetCredits: [credit("a", { expiresAt: now + 3_600_000 })],
    });
    expect(deriveNotifications([tomorrow], defaultSettings, now)[0]?.title).toBe(
      "A Claude Reset Expires in 1 Day",
    );
    const far = connection("codex", {
      resetCredits: [credit("a", { expiresAt: now + 4 * 86_400_000 })],
    });
    expect(deriveNotifications([far], defaultSettings, now)).toEqual([]);
    const off = {
      ...defaultSettings,
      notifications: { ...defaultSettings.notifications, expiringResets: false },
    };
    expect(deriveNotifications([codex], off, now)).toEqual([]);
  });
});

const run = (startedAt: number) => ({
  startedAt,
  finishedAt: startedAt + 10,
  outcome: "provider_unavailable" as const,
  error: "down",
});

describe("failures", () => {
  test("a disconnected account", () => {
    const conn = connection("copilot", {
      id: "p1",
      state: "reconnect_required",
      reconnectReason: "token_rejected",
      lastSuccessAt: 7_000,
    });
    const [item] = deriveNotifications([conn], defaultSettings, now);
    expect(item).toEqual(
      expect.objectContaining({
        tone: "bad",
        title: "Copilot Is Disconnected",
        id: "p1:disconnected:token_rejected:7000",
      }),
    );
  });
  test("a failed refresh keeps one id until the next success", () => {
    const first = deriveNotifications(
      [connection("grok", { latestRun: run(100) })],
      defaultSettings,
      now,
    );
    const second = deriveNotifications(
      [connection("grok", { latestRun: run(900) })],
      defaultSettings,
      now,
    );
    expect(first[0]?.title).toBe("Grok Refresh Failed");
    expect(first[0]?.tone).toBe("warn");
    expect(second[0]?.id).toBe(first[0]?.id ?? "");
    const recovered = deriveNotifications(
      [connection("grok", { latestRun: run(900), lastSuccessAt: 99_999 })],
      defaultSettings,
      now,
    );
    expect(recovered[0]?.id).not.toBe(first[0]?.id);
  });
  test("a run still in progress, a partial run and a disabled switch are quiet", () => {
    const inProgress = connection("grok", {
      latestRun: { startedAt: 1, finishedAt: null, outcome: null, error: null },
    });
    const partial = connection("grok", {
      latestRun: { startedAt: 1, finishedAt: 2, outcome: "partial", error: null },
    });
    expect(deriveNotifications([inProgress, partial], defaultSettings, now)).toEqual([]);
    const off = {
      ...defaultSettings,
      notifications: { ...defaultSettings.notifications, refreshFailures: false },
    };
    const bad = connection("grok", { state: "reconnect_required" });
    expect(deriveNotifications([bad], off, now)).toEqual([]);
  });
});

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

describe("read state", () => {
  test("round trip through storage", () => {
    const store = memory();
    saveRead(store, new Set(["b", "a"]));
    expect(store.data.get(readKey)).toBe('["a","b"]');
    expect([...loadRead(store)]).toEqual(["a", "b"]);
  });
  test("bad stored data reads as empty", () => {
    const store = memory();
    store.data.set(readKey, "{nope");
    expect(loadRead(store).size).toBe(0);
    store.data.set(readKey, '[1,"x",null]');
    expect([...loadRead(store)]).toEqual(["x"]);
  });
  test("mark one, mark all, prune", () => {
    const one = markRead(new Set(), "a");
    expect([...one]).toEqual(["a"]);
    expect([...markAllRead(one, [{ id: "b" }, { id: "c" }])].toSorted()).toEqual(["a", "b", "c"]);
    expect([...pruneRead(new Set(["a", "b"]), new Set(["b", "z"]))]).toEqual(["b"]);
  });
});
