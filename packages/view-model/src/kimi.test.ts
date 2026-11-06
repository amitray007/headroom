import { expect, test } from "bun:test";
import { groupByProvider, providerName } from "./labels.ts";
import { presentPanel } from "./present.ts";
import { connection, metric, percent } from "./test-fixtures.ts";

test("Kimi Code shows session and weekly usage without monthly stats or setup guidance", () => {
  const account = connection("kimi", {
    authMethod: "device_code",
    metrics: [
      percent("quota.five_hour", 35, { scope: "window:18000s" }),
      percent("quota.weekly", 62),
    ],
  });
  expect(providerName("kimi")).toBe("Kimi Code");
  expect(groupByProvider([account]).map((group) => group.provider)).toEqual(["kimi"]);
  const panel = presentPanel(account);
  expect(panel.cells.map((cell) => [cell.label, cell.window])).toEqual([
    ["Session", "5 hours"],
    ["Weekly", "7 days"],
  ]);
  expect(panel.facts).toEqual([]);
  expect(panel.tightest?.used).toBe(62);
});

test("cached monthly total and Code share stay out of Kimi panels and limiting windows", () => {
  const panel = presentPanel(
    connection("kimi", {
      metrics: [
        percent("quota.five_hour", 35, { scope: "window:18000s" }),
        percent("quota.weekly", 62),
        percent("quota.monthly_total", 98, { scope: "month" }),
        percent("quota.monthly_code", 97, { scope: "month" }),
      ],
    }),
  );
  expect(panel.cells.map((cell) => cell.label)).toEqual(["Session", "Weekly"]);
  expect(panel.facts).toEqual([]);
  expect(panel.tightest?.used).toBe(62);
});

test("Kimi keeps unknown supported windows unknown and explicit zero available", () => {
  const panel = presentPanel(
    connection("kimi", {
      metrics: [
        percent("quota.five_hour", 0, { scope: "window:18000s" }),
        metric("quota.weekly", { availability: "unknown" }),
      ],
    }),
  );
  expect(panel.cells.map((cell) => cell.label)).toEqual(["Session", "Weekly"]);
  expect(panel.cells[0]).toMatchObject({ kind: "meter", used: 0 });
  expect(panel.cells[1]).toMatchObject({ kind: "meter", used: null });
});

test("Kimi has no fabricated monthly meter before its first reading", () => {
  const panel = presentPanel(connection("kimi", { snapshot: null }));
  expect(panel.cells).toEqual([]);
  expect(panel.facts).toEqual([]);
  expect(panel.tightest).toBeNull();
});
