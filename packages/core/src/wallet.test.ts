import { describe, expect, test } from "bun:test";

import { openDatabase, schema } from "./db/index.ts";
import {
  type Cost,
  costSchema,
  topUpInputSchema,
  UnknownConnectionError,
  WalletStore,
} from "./wallet.ts";

function setup() {
  const { db, sqlite } = openDatabase({ path: ":memory:" });
  let tick = 1_700_000_000_000;
  const store = new WalletStore(db, () => new Date(tick++));
  const connect = (id: string) =>
    db
      .insert(schema.connections)
      .values({
        id,
        provider: "codex",
        providerAccountId: id,
        scope: "individual",
        label: id,
        authMethod: "import",
        state: "ready",
        interface: "private",
        connectorVersion: "0.0.0",
      })
      .run();
  return { db, sqlite, store, connect };
}

const paid: Cost = {
  kind: "paid",
  price: { minor: 2000, currency: "USD" },
  cycle: "monthly",
  renewsOn: "2026-11-01",
};

describe("wallet costs", () => {
  test("paid, free and included round-trip and replace each other", () => {
    const h = setup();
    h.connect("a");
    h.connect("b");
    h.connect("c");
    h.store.setCost("a", paid);
    h.store.setCost("b", { kind: "free" });
    h.store.setCost("c", { kind: "included", includedWith: "Team plan" });
    expect(h.store.book().costs).toEqual({
      a: paid,
      b: { kind: "free" },
      c: { kind: "included", includedWith: "Team plan" },
    });
    h.store.setCost("a", { kind: "free" });
    expect(h.store.book().costs["a"]).toEqual({ kind: "free" });
    const row = h.db
      .select()
      .from(schema.walletCosts)
      .all()
      .find((r) => r.connectionId === "a");
    expect(row?.priceMinor).toBeNull();
  });

  test("clearCost returns to Not set and is idempotent", () => {
    const h = setup();
    h.connect("a");
    h.store.setCost("a", paid);
    h.store.clearCost("a");
    h.store.clearCost("a");
    expect(h.store.book().costs).toEqual({});
  });

  test("an unknown connection throws", () => {
    const h = setup();
    expect(() => h.store.setCost("nope", paid)).toThrow(UnknownConnectionError);
  });

  test("a row that no longer parses is skipped", () => {
    const h = setup();
    h.connect("a");
    h.connect("b");
    h.store.setCost("b", { kind: "free" });
    h.sqlite.run("INSERT INTO wallet_costs (connection_id, kind) VALUES ('a', 'paid')");
    expect(h.store.book().costs).toEqual({ b: { kind: "free" } });
  });

  test("deleting a connection removes its cost but keeps its top-ups", () => {
    const h = setup();
    h.connect("a");
    h.store.setCost("a", paid);
    h.store.addTopUp({
      connectionId: "a",
      date: "2026-10-01",
      kind: "free",
      price: null,
      credits: 5,
      note: null,
    });
    h.sqlite.run("DELETE FROM connections WHERE id = 'a'");
    const book = h.store.book();
    expect(book.costs).toEqual({});
    expect(book.topUps).toHaveLength(1);
    expect(book.topUps[0]?.connectionId).toBe("a");
  });
});

const input = (date: string, note: string | null = null) => ({
  connectionId: "a",
  date,
  kind: "paid" as const,
  price: { minor: 500, currency: "EUR" as const },
  credits: 10.5,
  note,
});

describe("wallet top-ups", () => {
  test("add generates an id; the book orders by date then newest first; remove is idempotent", () => {
    const h = setup();
    h.connect("a");
    const first = h.store.addTopUp(input("2026-10-01", "first"));
    const second = h.store.addTopUp(input("2026-10-01", "second"));
    const third = h.store.addTopUp(input("2026-09-30", "older"));
    expect(first.id).not.toBe(second.id);
    expect(h.store.book().topUps.map((t) => t.note)).toEqual(["second", "first", "older"]);
    expect(h.store.book().topUps[0]).toEqual(second);
    h.store.removeTopUp(third.id);
    h.store.removeTopUp(third.id);
    expect(h.store.book().topUps).toHaveLength(2);
  });

  test("an unknown connection throws", () => {
    const h = setup();
    expect(() => h.store.addTopUp(input("2026-10-01"))).toThrow(UnknownConnectionError);
  });

  test("a stored top-up that no longer parses is skipped", () => {
    const h = setup();
    h.connect("a");
    h.store.addTopUp(input("2026-10-01"));
    h.sqlite.run(
      "INSERT INTO wallet_top_ups (id, connection_id, date, kind) VALUES ('x', 'a', '2026-02-30', 'paid')",
    );
    expect(h.store.book().topUps).toHaveLength(1);
  });
});

describe("wallet schemas", () => {
  test("cost rules", () => {
    expect(costSchema.safeParse(paid).success).toBe(true);
    expect(costSchema.safeParse({ ...paid, renewsOn: "2026-02-30" }).success).toBe(false);
    expect(costSchema.safeParse({ ...paid, price: { minor: 0, currency: "USD" } }).success).toBe(
      false,
    );
    expect(costSchema.safeParse({ ...paid, price: { minor: 1.5, currency: "USD" } }).success).toBe(
      false,
    );
    expect(costSchema.safeParse({ ...paid, price: { minor: 5, currency: "XXX" } }).success).toBe(
      false,
    );
    expect(costSchema.safeParse({ ...paid, renewsOn: null }).success).toBe(true);
    expect(costSchema.safeParse({ kind: "included", includedWith: "   " }).success).toBe(false);
    expect(costSchema.safeParse({ kind: "included", includedWith: "x".repeat(81) }).success).toBe(
      false,
    );
    expect(costSchema.parse({ kind: "included", includedWith: "  Pro  " })).toEqual({
      kind: "included",
      includedWith: "Pro",
    });
    expect(costSchema.safeParse({ kind: "unset" }).success).toBe(false);
  });

  test("top-up rules", () => {
    const base = {
      connectionId: "a",
      date: "2026-10-01",
      kind: "paid",
      price: { minor: 100, currency: "USD" },
      credits: null,
      note: "  hi  ",
    };
    expect(topUpInputSchema.parse(base).note).toBe("hi");
    expect(topUpInputSchema.parse({ ...base, note: "   " }).note).toBeNull();
    expect(topUpInputSchema.safeParse({ ...base, price: null }).success).toBe(false);
    expect(topUpInputSchema.safeParse({ ...base, kind: "free" }).success).toBe(false);
    expect(topUpInputSchema.safeParse({ ...base, kind: "free", price: null }).success).toBe(true);
    expect(topUpInputSchema.safeParse({ ...base, credits: 0 }).success).toBe(false);
    expect(topUpInputSchema.safeParse({ ...base, credits: Infinity }).success).toBe(false);
    expect(topUpInputSchema.safeParse({ ...base, note: "x".repeat(201) }).success).toBe(false);
    expect(topUpInputSchema.safeParse({ ...base, date: "2026-02-30" }).success).toBe(false);
    expect(topUpInputSchema.safeParse({ ...base, date: "2028-02-29" }).success).toBe(true);
  });
});
