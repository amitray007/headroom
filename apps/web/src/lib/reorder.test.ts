import { describe, expect, test } from "bun:test";

import { connection } from "@headroom/view-model/test-fixtures";
import {
  applyOrder,
  clampShift,
  moveAccount,
  moveItem,
  moveProvider,
  offsetsFor,
  orderBody,
  orderOf,
  targetIndex,
  type DisplayOrder,
} from "./reorder.ts";

const order: DisplayOrder = {
  providers: ["claude", "codex", "cursor", "grok"],
  accounts: { claude: ["c1"], codex: ["x1", "x2", "x3"], grok: ["g1"] },
};

describe("moving a provider", () => {
  test("moves among the shown providers and leaves hidden ones in their slots", () => {
    const next = moveProvider(order, ["claude", "codex", "grok"], "grok", 0);
    expect(next.providers).toEqual(["grok", "claude", "cursor", "codex"]);
    expect(next.accounts).toEqual(order.accounts);
  });
  test("clamps the target and ignores a provider that is not shown", () => {
    expect(moveProvider(order, ["claude", "codex", "grok"], "claude", 9).providers).toEqual([
      "codex",
      "grok",
      "cursor",
      "claude",
    ]);
    expect(moveProvider(order, ["claude", "codex"], "grok", 0)).toBe(order);
  });
});

describe("moving an account", () => {
  test("shifts accounts only among their own provider", () => {
    const next = moveAccount(order, "codex", "x3", 0);
    expect(next.accounts["codex"]).toEqual(["x3", "x1", "x2"]);
    expect(next.accounts["claude"]).toEqual(["c1"]);
    expect(next.providers).toEqual(order.providers);
  });
  test("an account cannot leave its provider", () => {
    expect(moveAccount(order, "claude", "x1", 0)).toBe(order);
    expect(moveAccount(order, "codex", "c1", 0)).toBe(order);
  });
});

describe("the request body", () => {
  test("carries the full order as plain arrays", () => {
    expect(orderBody(moveAccount(order, "codex", "x1", 2))).toEqual({
      providers: ["claude", "codex", "cursor", "grok"],
      accounts: { claude: ["c1"], codex: ["x2", "x3", "x1"], grok: ["g1"] },
    });
  });
});

describe("applying an order", () => {
  const list = [
    connection("claude", { id: "c1" }),
    connection("codex", { id: "x1", createdAt: 1 }),
    connection("codex", { id: "x2", createdAt: 2 }),
    connection("grok", { id: "g1" }),
  ];
  test("sorts providers and accounts", () => {
    const next = applyOrder(
      list,
      moveAccount(moveProvider(order, ["claude", "codex", "grok"], "codex", 0), "codex", "x2", 0),
    );
    expect(next.map((entry) => entry.id)).toEqual(["x2", "x1", "c1", "g1"]);
  });
  test("reads the order from a list", () => {
    expect(orderOf(list, ["grok", "claude"])).toEqual({
      providers: ["grok", "claude", "codex"],
      accounts: { claude: ["c1"], codex: ["x1", "x2"], grok: ["g1"] },
    });
  });
});

describe("drag geometry", () => {
  const slots = [
    { top: 100, height: 60 },
    { top: 160, height: 80 },
    { top: 240, height: 60 },
  ];
  test("moveItem", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 2, -4)).toEqual([3, 1, 2]);
  });
  test("target index follows the leading edge", () => {
    expect(targetIndex(slots, 0, 0)).toBe(0);
    expect(targetIndex(slots, 0, 100)).toBe(1);
    expect(targetIndex(slots, 0, 140)).toBe(2);
    expect(targetIndex(slots, 2, -140)).toBe(0);
    expect(targetIndex(slots, 2, -30)).toBe(2);
    expect(targetIndex(slots, 1, 60)).toBe(2);
  });
  test("offsets open a gap where the item lands", () => {
    expect(offsetsFor(slots, 0, 2)).toEqual([140, -60, -60]);
    expect(offsetsFor(slots, 2, 0)).toEqual([60, 60, -140]);
    expect(offsetsFor(slots, 1, 1)).toEqual([0, 0, 0]);
  });
  test("the shift clamps inside the list", () => {
    expect(clampShift(slots, 0, -50)).toBe(0);
    expect(clampShift(slots, 0, 500)).toBe(140);
    expect(clampShift(slots, 1, -500)).toBe(-60);
  });
});
