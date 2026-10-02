import { describe, expect, test } from "bun:test";

import {
  accountName,
  authMethodWords,
  groupByProvider,
  planLabel,
  providerName,
  refreshFailed,
  statusOf,
} from "./labels.ts";
import { connection } from "./test-fixtures.ts";

describe("names", () => {
  test("providers", () => {
    expect(providerName("vercel_ai_gateway")).toBe("Vercel AI Gateway");
    expect(providerName("copilot")).toBe("Copilot");
  });
  test("account name falls back to the scope word, never Member", () => {
    expect(accountName({ name: "Side Project", scope: "individual" })).toBe("Side Project");
    expect(accountName({ name: "  ", scope: "individual" })).toBe("Personal");
    expect(accountName({ name: null, scope: "member" })).toBe("Work");
    expect(accountName({ name: null, scope: "team_admin" })).toBe("Team");
    expect(accountName({ name: null, scope: "organization" })).toBe("Team");
  });
  test("plans", () => {
    expect(planLabel("pro")).toBe("Pro");
    expect(planLabel("x_premium")).toBe("X Premium");
    expect(planLabel("SuperGrok")).toBe("SuperGrok");
    expect(planLabel(null)).toBeNull();
    expect(planLabel("")).toBeNull();
  });
  test("sign-in words", () => {
    expect(authMethodWords("api_key")).toBe("API Key");
    expect(authMethodWords("approval_poll")).toBe("Approve in Browser");
    expect(authMethodWords("cli_login")).toBe("Sign In");
  });
});

describe("grouping", () => {
  test("provider order, then oldest first", () => {
    const groups = groupByProvider([
      connection("copilot", { id: "p" }),
      connection("codex", { id: "x2", createdAt: 20 }),
      connection("claude", { id: "c" }),
      connection("codex", { id: "x1", createdAt: 10 }),
    ]);
    expect(groups.map((g) => [g.provider, g.connections.map((c) => c.id)])).toEqual([
      ["claude", ["c"]],
      ["codex", ["x1", "x2"]],
      ["copilot", ["p"]],
    ]);
  });
});

describe("status", () => {
  const failed = { startedAt: 1, finishedAt: 2, outcome: "rate_limited", error: null } as const;
  test("words and tones", () => {
    expect(statusOf(connection("claude"))).toEqual({ word: "Active", tone: "good" });
    expect(statusOf(connection("claude", { state: "partial" })).word).toBe("Active");
    expect(statusOf(connection("claude", { state: "paused", stale: true })).word).toBe("Paused");
    expect(
      statusOf(connection("claude", { state: "reconnect_required", latestRun: failed })).word,
    ).toBe("Disconnected");
    expect(statusOf(connection("claude", { latestRun: failed }))).toEqual({
      word: "Refresh Failed",
      tone: "warn",
    });
    expect(statusOf(connection("claude", { stale: true }))).toEqual({
      word: "Out of Date",
      tone: "warn",
    });
  });
  test("a run in progress is not a failure", () => {
    expect(refreshFailed({ startedAt: 1, finishedAt: null, outcome: null, error: null })).toBe(
      false,
    );
    expect(refreshFailed(null)).toBe(false);
    expect(refreshFailed({ ...failed, outcome: "partial" })).toBe(false);
  });
});
