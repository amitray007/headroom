import { expect, test } from "bun:test";

import { splitLabel } from "./label.ts";

test("splits an identity and a plan", () => {
  expect(splitLabel("codex", "alex@example.com (pro)")).toEqual({
    identity: "alex@example.com",
    plan: "pro",
  });
  expect(splitLabel("claude", "owner@acme.example (max)")).toEqual({
    identity: "owner@acme.example",
    plan: "max",
  });
});

test("keeps an identity with no plan", () => {
  expect(splitLabel("cursor", "dev@example.com")).toEqual({
    identity: "dev@example.com",
    plan: null,
  });
});

test("a generic fallback label is no identity", () => {
  expect(splitLabel("codex", "Codex (plus)")).toEqual({ identity: null, plan: "plus" });
  expect(splitLabel("grok", "Grok")).toEqual({ identity: null, plan: null });
  expect(splitLabel("cursor", "Cursor")).toEqual({ identity: null, plan: null });
  expect(splitLabel("vercel_ai_gateway", "Vercel AI Gateway")).toEqual({
    identity: null,
    plan: null,
  });
  expect(splitLabel("antigravity", "Antigravity (free)")).toEqual({ identity: null, plan: "free" });
});

test("a Copilot label carries a login and no plan", () => {
  expect(splitLabel("copilot", "demo-dev (Copilot)")).toEqual({
    identity: "demo-dev",
    plan: null,
  });
});

test("only the trailing group is the plan, and empty groups are ignored", () => {
  expect(splitLabel("codex", "a (b)@example.com (pro)")).toEqual({
    identity: "a (b)@example.com",
    plan: "pro",
  });
  expect(splitLabel("codex", "owner@example.com ()")).toEqual({
    identity: "owner@example.com",
    plan: null,
  });
  expect(splitLabel("codex", "")).toEqual({ identity: null, plan: null });
});

test("a plan that repeats the product name keeps only the plan", () => {
  expect(splitLabel("antigravity", "owner@example.com (Antigravity Starter Quota)")).toEqual({
    identity: "owner@example.com",
    plan: "Starter Quota",
  });
});

test("reads only a final parenthesis group with nothing nested", () => {
  expect(splitLabel("codex", "a (b) c)")).toEqual({ identity: "a (b) c)", plan: null });
  expect(splitLabel("codex", "team (eu) (pro)")).toEqual({ identity: "team (eu)", plan: "pro" });
  expect(splitLabel("codex", "(pro)")).toEqual({ identity: null, plan: "pro" });
});

test("stays fast on a long run of spaces", () => {
  const started = performance.now();
  splitLabel("codex", `a${" ".repeat(50_000)}(`);
  splitLabel("codex", `a${" ".repeat(50_000)}x)`);
  expect(performance.now() - started).toBeLessThan(50);
});
