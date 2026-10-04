import { describe, expect, test } from "bun:test";

import { AccountEventStore } from "./account-events.ts";
import { ActionStore } from "./actions.ts";
import { AutomationStore } from "./automation.ts";
import type { AccountEventDetail } from "./automation-schemas.ts";
import { openDatabase, schema } from "./db/index.ts";
import {
  TopUpPriceError,
  UnknownConnectionError,
  UnknownTopUpError,
  WalletStore,
  type TopUpUpdate,
} from "./wallet.ts";

const base = 1_800_000_000_000;
const day = 86_400_000;

const clock = () => new Date(base);

function setup() {
  const { db } = openDatabase({ path: ":memory:" });
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
  return {
    db,
    connect,
    events: new AccountEventStore(db, clock),
    automation: new AutomationStore(db, clock),
    wallet: new WalletStore(db, clock),
    actions: new ActionStore(db, clock),
  };
}

const topUp = (added: number): AccountEventDetail => ({
  kind: "top_up_detected",
  unit: "codex_credits",
  previous: 1,
  current: 1 + added,
  added,
  topUpId: null,
});

describe("AccountEventStore", () => {
  test("records with the detail's kind and reads back newest first, limited per account", () => {
    const h = setup();
    h.connect("a");
    h.connect("b");
    for (let i = 1; i <= 5; i++) h.events.record("a", base + i, "credits.balance", topUp(i));
    h.events.record("b", base + 100, null, {
      kind: "reset_granted",
      creditId: "c1",
      expiresAt: null,
      available: null,
    });
    const rows = h.events.recent(new Date(base), 3);
    expect(rows.filter((e) => e.connectionId === "a").map((e) => e.occurredAt)).toEqual([
      base + 5,
      base + 4,
      base + 3,
    ]);
    expect(rows.map((e) => e.occurredAt)).toEqual([base + 100, base + 5, base + 4, base + 3]);
    const stored = h.db.select().from(schema.accountEvents).all();
    expect(stored.map((row) => row.kind).toSorted()).toEqual([
      "reset_granted",
      "top_up_detected",
      "top_up_detected",
      "top_up_detected",
      "top_up_detected",
      "top_up_detected",
    ]);
  });

  test("recent skips events before `since`, and prune deletes older ones", () => {
    const h = setup();
    h.connect("a");
    h.events.record("a", base - 8 * day, null, topUp(1));
    h.events.record("a", base - day, null, topUp(2));
    expect(h.events.recent(new Date(base - 7 * day))).toHaveLength(1);
    expect(h.events.prune(new Date(base - 7 * day))).toBe(1);
    expect(h.events.recent(new Date(0))).toHaveLength(1);
  });

  test("rejects a detail that breaks the schema and skips an unreadable row", () => {
    const h = setup();
    h.connect("a");
    expect(() =>
      h.events.record("a", base, null, Object.assign({}, topUp(1), { added: -1 })),
    ).toThrow();
    h.db
      .insert(schema.accountEvents)
      .values({
        id: "x",
        connectionId: "a",
        kind: "top_up_detected",
        occurredAt: new Date(base),
        metricKey: null,
        detailJson: "{not json",
      })
      .run();
    expect(h.events.recent(new Date(0))).toEqual([]);
  });

  test("events are deleted with their connection", () => {
    const h = setup();
    h.connect("a");
    h.events.record("a", base, null, topUp(1));
    h.db.delete(schema.connections).run();
    expect(h.events.recent(new Date(0))).toEqual([]);
  });
});

describe("AutomationStore", () => {
  test("an auto-reset rule round-trips, replaces and clears", () => {
    const h = setup();
    h.connect("a");
    expect(h.automation.autoReset("a")).toBeNull();
    const rule = {
      enabled: true,
      window: "either",
      thresholdPercent: 95,
      minHoursLeft: 6,
    } as const;
    h.automation.setAutoReset("a", rule);
    expect(h.automation.autoReset("a")).toEqual(rule);
    h.automation.setAutoReset("a", { ...rule, enabled: false });
    expect(h.automation.autoReset("a")?.enabled).toBe(false);
    expect([...h.automation.autoResetRules().keys()]).toEqual(["a"]);
    h.automation.clearAutoReset("a");
    expect(h.automation.autoReset("a")).toBeNull();
  });

  test("budgets are per metric, replaced by key, and listed per account", () => {
    const h = setup();
    h.connect("a");
    h.connect("b");
    h.automation.setBudget("a", "on_demand.used", 20, "USD");
    h.automation.setBudget("a", "extra_usage.used", 5, "USD");
    h.automation.setBudget("a", "on_demand.used", 25, "USD");
    h.automation.setBudget("b", "spend.30d", 100, "gateway_credits");
    expect(h.automation.budgets("a")).toEqual([
      { metricKey: "extra_usage.used", amount: 5, unit: "USD" },
      { metricKey: "on_demand.used", amount: 25, unit: "USD" },
    ]);
    expect(h.automation.allBudgets().get("b")).toEqual([
      { metricKey: "spend.30d", amount: 100, unit: "gateway_credits" },
    ]);
    h.automation.clearBudget("a", "on_demand.used");
    expect(h.automation.budgets("a")).toHaveLength(1);
  });

  test("an unknown connection is refused", () => {
    const h = setup();
    expect(() =>
      h.automation.setAutoReset("nope", {
        enabled: true,
        window: "weekly",
        thresholdPercent: 100,
        minHoursLeft: 24,
      }),
    ).toThrow(UnknownConnectionError);
    expect(() => h.automation.setBudget("nope", "k", 1, "USD")).toThrow(UnknownConnectionError);
  });
});

describe("ActionStore origin and queries", () => {
  test("create records the origin, defaulting to owner", () => {
    const h = setup();
    h.connect("a");
    expect(h.actions.create("a", "consume_reset_credit").origin).toBe("owner");
    expect(h.actions.create("a", "consume_reset_credit", "automation").origin).toBe("automation");
  });

  test("automaticSince lists only automatic actions at or after the time", () => {
    const h = setup();
    h.connect("a");
    h.actions.create("a", "consume_reset_credit");
    const auto = h.actions.create("a", "consume_reset_credit", "automation");
    expect(h.actions.automaticSince("a", new Date(base)).map((r) => r.id)).toEqual([auto.id]);
    expect(h.actions.automaticSince("a", new Date(base + 1))).toEqual([]);
  });

  test("explainsChangeSince counts in-flight, succeeded and uncertain actions, not failed ones", () => {
    const h = setup();
    h.connect("a");
    const row = h.actions.create("a", "consume_reset_credit");
    expect(h.actions.explainsChangeSince("a", new Date(base))).toBe(true);
    expect(h.actions.explainsChangeSince("a", new Date(base + 1))).toBe(false);
    h.actions.complete(row.id, "failed");
    expect(h.actions.explainsChangeSince("a", new Date(base))).toBe(false);
    const other = h.actions.create("a", "consume_reset_credit");
    h.actions.complete(other.id, "uncertain");
    expect(h.actions.explainsChangeSince("a", new Date(base))).toBe(true);
  });
});

describe("WalletStore detected top-ups and expiry", () => {
  const detected = {
    connectionId: "a",
    date: "2026-10-04",
    kind: "paid",
    price: null,
    credits: 1000,
    note: null,
    expiresOn: null,
    expiryAlertDays: null,
  } as const;
  const edit: TopUpUpdate = {
    date: "2026-10-04",
    kind: "paid",
    price: { minor: 1000, currency: "USD" },
    credits: 1000,
    note: null,
    expiresOn: "2027-01-01",
    expiryAlertDays: 30,
  };

  test("a detected top-up keeps its source through an edit and may stay unpriced", () => {
    const h = setup();
    h.connect("a");
    const added = h.wallet.addTopUp(detected, "detected");
    expect(added.source).toBe("detected");
    h.wallet.updateTopUp(added.id, {
      ...edit,
      price: null,
      expiresOn: null,
      expiryAlertDays: null,
    });
    expect(h.wallet.book().topUps[0]).toMatchObject({ source: "detected", price: null });
    const priced = h.wallet.updateTopUp(added.id, edit);
    expect(priced).toMatchObject({
      id: added.id,
      connectionId: "a",
      source: "detected",
      expiresOn: "2027-01-01",
      expiryAlertDays: 30,
    });
    expect(h.wallet.book().topUps[0]).toEqual(priced);
  });

  test("an owner top-up cannot become paid without a price, and free cannot carry one", () => {
    const h = setup();
    h.connect("a");
    const added = h.wallet.addTopUp({ ...detected, kind: "free" });
    expect(added.source).toBe("owner");
    expect(() => h.wallet.updateTopUp(added.id, { ...edit, price: null })).toThrow(TopUpPriceError);
    expect(() => h.wallet.updateTopUp(added.id, { ...edit, kind: "free" })).toThrow(
      TopUpPriceError,
    );
    expect(h.wallet.updateTopUp(added.id, { ...edit, kind: "free", price: null }).kind).toBe(
      "free",
    );
  });

  test("an unknown id throws UnknownTopUpError", () => {
    const h = setup();
    expect(() => h.wallet.updateTopUp("missing", edit)).toThrow(UnknownTopUpError);
  });
});
