import { describe, expect, test } from "bun:test";

import type { OverviewConnection } from "../../api.ts";
import { connection, metric, percent } from "@headroom/view-model/test-fixtures";
import {
  balanceKey,
  columnLeft,
  columnsOf,
  defaultSort,
  driversOf,
  limitingName,
  nextSort,
  pickBest,
  rowOf,
  sortRows,
} from "./compare-model.ts";

const reset = Date.UTC(2025, 9, 2, 12, 0);

function claude(
  id: string,
  name: string,
  session: number | null,
  weekly: number,
  over: Partial<OverviewConnection> = {},
): OverviewConnection {
  return connection("claude", {
    id,
    name,
    metrics: [
      session === null
        ? metric("five_hour", { scope: "window:18000s" })
        : percent("five_hour", session, { scope: "window:18000s", resetsAt: reset }),
      percent("seven_day", weekly, { scope: "window:604800s", resetsAt: reset }),
    ],
    ...over,
  });
}

const rows = [
  rowOf(claude("a", "Alpha", 12, 34)),
  rowOf(claude("b", "Bravo", 80, 10)),
  rowOf(claude("c", "Charlie", 5, 5, { state: "paused" })),
];

describe("pickBest", () => {
  test("takes the active account with the most room", () => {
    const pick = pickBest(rows);
    expect(pick.best?.connection.id).toBe("a");
    expect(pick.next?.connection.id).toBe("b");
    expect(pick.counted).toBe(2);
    expect(pick.inactive).toBe(1);
  });

  test("never recommends an inactive account, even the roomiest", () => {
    const only = [rowOf(claude("c", "Charlie", 0, 0, { state: "reconnect_required" }))];
    expect(pickBest(only).best).toBeNull();
  });

  test("an account with no known room is not ranked", () => {
    const unknown = rowOf(connection("claude", { id: "u", metrics: [] }));
    expect(pickBest([unknown]).best).toBeNull();
    expect(pickBest([unknown, rows[1]!]).best?.connection.id).toBe("b");
  });

  test("a session that has not started counts as full", () => {
    const fresh = rowOf(claude("n", "Fresh", null, 40));
    expect(fresh.room.left).toBe(60);
    expect(pickBest([rows[1]!, fresh]).best?.connection.id).toBe("n");
  });

  test("a tie keeps the saved order", () => {
    const x = rowOf(claude("x", "X", 50, 50));
    const y = rowOf(claude("y", "Y", 50, 50));
    expect(pickBest([x, y]).best?.connection.id).toBe("x");
  });
});

describe("sortRows", () => {
  test("room descending by default, inactive last", () => {
    expect(sortRows(rows, defaultSort).map((row) => row.name)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);
  });

  test("inactive stay last in either direction", () => {
    const asc = sortRows(rows, { key: "room", dir: "asc" }).map((row) => row.name);
    expect(asc).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  test("by a window column, unknown sorts last", () => {
    const blank = rowOf(connection("claude", { id: "u", name: "Blank", metrics: [] }));
    const sorted = sortRows([blank, ...rows], { key: "five_hour", dir: "desc" });
    expect(sorted.map((row) => row.name)).toEqual(["Alpha", "Bravo", "Blank", "Charlie"]);
    const asc = sortRows([blank, ...rows], { key: "five_hour", dir: "asc" });
    expect(asc.map((row) => row.name)).toEqual(["Bravo", "Alpha", "Blank", "Charlie"]);
  });

  test("by name, A to Z then Z to A", () => {
    const sort = nextSort(defaultSort, "name");
    expect(sort).toEqual({ key: "name", dir: "asc" });
    expect(sortRows(rows, sort).map((row) => row.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    const flipped = nextSort(sort, "name");
    expect(sortRows(rows, flipped).map((row) => row.name)).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  test("a new column starts descending, the same column flips", () => {
    expect(nextSort(defaultSort, "five_hour")).toEqual({ key: "five_hour", dir: "desc" });
    expect(nextSort(defaultSort, "room")).toEqual({ key: "room", dir: "asc" });
  });
});

describe("columns and drivers", () => {
  test("session first, then the rest in first-seen order", () => {
    const extra = rowOf(
      connection("claude", {
        id: "m",
        metrics: [
          percent("seven_day", 10, { scope: "window:604800s" }),
          percent("limits.fable", 20, { scope: "window:604800s" }),
          percent("five_hour", 5, { scope: "window:18000s" }),
        ],
      }),
    );
    const keys = columnsOf([extra, ...rows]).map((column) => column.key);
    expect(keys[0]).toBe("five_hour");
    expect(keys).toEqual(["five_hour", "seven_day", "limits.fable"]);
  });

  test("a model window is a chip only when it limits", () => {
    const calm = rowOf(
      connection("claude", {
        metrics: [
          percent("five_hour", 10, { scope: "window:18000s" }),
          percent("seven_day", 20, { scope: "window:604800s" }),
          percent("limits.fable", 5, { scope: "window:604800s" }),
        ],
      }),
    );
    expect(driversOf(calm.room).map((driver) => driver.ref.key)).toEqual([
      "five_hour",
      "seven_day",
    ]);
    const tight = rowOf(
      connection("claude", {
        metrics: [
          percent("five_hour", 10, { scope: "window:18000s" }),
          percent("seven_day", 20, { scope: "window:604800s" }),
          percent("limits.fable", 95, { scope: "window:604800s" }),
        ],
      }),
    );
    const drivers = driversOf(tight.room);
    expect(drivers.map((driver) => driver.name)).toEqual(["Session", "Weekly", "Weekly (fable)"]);
    expect(drivers.filter((driver) => driver.limiting).map((driver) => driver.ref.key)).toEqual([
      "limits.fable",
    ]);
    expect(limitingName(tight.room)).toBe("Weekly (fable)");
  });
});

const gateway = (id: string, left: number, spent: number): OverviewConnection =>
  connection("vercel_ai_gateway", {
    id,
    metrics: [
      metric(balanceKey, {
        kind: "credits",
        scope: "account",
        unit: "credits",
        valueNum: left,
        valueText: String(left),
      }),
      metric("credits.total_used", {
        kind: "credits",
        scope: "account",
        unit: "credits",
        valueNum: spent,
        valueText: String(spent),
      }),
    ],
  });

describe("balances", () => {
  test("room is the balance as a share of everything granted", () => {
    const row = rowOf(gateway("g1", 3, 7));
    expect(row.room).toMatchObject({ left: 30, unit: "percent" });
    expect(row.balance).toMatchObject({ value: 3, total: 10 });
    expect(columnLeft(row, balanceKey)).toBe(30);
    expect(columnsOf([row]).map((column) => column.label)).toEqual(["Credit Balance"]);
  });

  test("the roomier balance wins", () => {
    const pick = pickBest([rowOf(gateway("g1", 3, 7)), rowOf(gateway("g2", 9, 1))]);
    expect(pick.best?.connection.id).toBe("g2");
  });
});
