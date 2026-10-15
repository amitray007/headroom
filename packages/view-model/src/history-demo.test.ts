import { describe, expect, test } from "bun:test";

import { meterWindows } from "./accounts.ts";
import { demoOverview } from "./demo.ts";
import { demoHistory } from "./history-demo.ts";
import { encodeHistory, historySchema, historyWireSchema } from "./history.ts";

const anchor = Date.UTC(2026, 9, 3, 12, 0, 0);
const hour = 3_600_000;
const seeds = [1, 7, 42];

describe("demoHistory", () => {
  test("the same inputs give the same history, and it parses", () => {
    for (const seed of seeds) {
      const { connections } = demoOverview(seed, anchor);
      const a = demoHistory(seed, connections, anchor, 90);
      expect(a).toEqual(demoHistory(seed, connections, anchor, 90));
      expect(historySchema.safeParse(a).success).toBe(true);
      expect(a.connections.map((entry) => entry.id)).toEqual(connections.map((c) => c.id));
    }
  });

  test("the wire form parses back to the same history", () => {
    for (const seed of seeds) {
      const history = demoHistory(seed, demoOverview(seed, anchor).connections, anchor, 90);
      const wire: unknown = JSON.parse(JSON.stringify(encodeHistory(history)));
      expect(historyWireSchema.parse(wire)).toEqual(history);
    }
  });

  test("the current window ends at the value the overview reports", () => {
    for (const seed of seeds) {
      const { connections } = demoOverview(seed, anchor);
      const history = demoHistory(seed, connections, anchor, 90);
      let checked = 0;
      for (const connection of connections) {
        const entry = history.connections.find((item) => item.id === connection.id);
        for (const window of meterWindows(connection)) {
          if (window.used === null || window.start === null) continue;
          const series = entry?.series.find((item) => item.providerMetricKey === window.key);
          if (series === undefined) continue;
          const last = series.points.at(-1);
          if (last === undefined || last[0] < window.start) continue;
          // Buckets start at local hours, so the last one is within an hour before the anchor.
          expect(last[0]).toBeLessThanOrEqual(anchor);
          expect(last[0]).toBeGreaterThan(anchor - hour);
          expect(last[1]).toBe(window.used);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(5);
    }
  });

  test("points are hourly, ordered, within 0..100, and gaps carry failures", () => {
    const { connections } = demoOverview(1, anchor);
    const history = demoHistory(1, connections, anchor, 90);
    for (const connection of history.connections) {
      for (const series of connection.series) {
        series.points.forEach(([at, used], index) => {
          // Buckets start on local hours, which in a half-hour zone such as IST is not a UTC hour.
          expect((at - new Date(at).getTimezoneOffset() * 60_000) % hour).toBe(0);
          expect(used).toBeGreaterThanOrEqual(0);
          expect(used).toBeLessThanOrEqual(100);
          if (index > 0) expect(at).toBeGreaterThan(series.points[index - 1]?.[0] ?? 0);
        });
      }
    }
    expect(history.connections.some((entry) => entry.failures.length > 0)).toBe(true);
    expect(history.from).toBeLessThanOrEqual(anchor - 90 * 24 * hour);
  });
});
