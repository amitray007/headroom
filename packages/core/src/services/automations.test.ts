import { describe, expect, test } from "bun:test";

import { AccountEventStore } from "../account-events.ts";
import { ActionStore } from "../actions.ts";
import { AutomationStore } from "../automation.ts";
import type { AutoResetRule } from "../automation-schemas.ts";
import type { ActionResult, CollectResult, ResetCreditObservation } from "../connector.ts";
import { CredentialStore } from "../credentials.ts";
import { createKeyring, generateKeyHex, parseKeyHex } from "../crypto/index.ts";
import { openDatabase } from "../db/index.ts";
import { LeaseStore } from "../leases.ts";
import { ConnectionStore } from "../lifecycle.ts";
import { SnapshotStore } from "../snapshots.ts";
import { WalletStore } from "../wallet.ts";
import { AccountEventService } from "./account-events.ts";
import { ActionService } from "./actions.ts";
import { AutoResetService, expiryFreshMs, expiryRetryBaseMs } from "./auto-reset.ts";
import { CollectionService } from "./collect.ts";
import { credentialFixture, FakeConnector } from "./fake-connector.ts";

const base = 1_800_000_000_000;
const hour = 3_600_000;
const day = 24 * hour;
const week = 7 * day;

function setup(options: { enabled?: boolean; observerThrows?: boolean } = {}) {
  const { db } = openDatabase({ path: ":memory:" });
  let now = base;
  let enabled = options.enabled ?? true;
  const clock = () => new Date(now);
  const keyring = createKeyring({ 1: parseKeyHex(generateKeyHex()) });
  const connector = new FakeConnector("codex");
  const registry = {
    get: (p: string) => (p === "codex" ? connector : undefined),
    list: () => [connector],
  };
  const connections = new ConnectionStore(db, clock);
  const credentials = new CredentialStore(db, keyring);
  const snapshots = new SnapshotStore(db, clock);
  const leases = new LeaseStore(db, clock);
  const actionRows = new ActionStore(db, clock);
  const events = new AccountEventStore(db, clock);
  const automation = new AutomationStore(db, clock);
  const wallet = new WalletStore(db, clock);
  const observer = options.observerThrows
    ? {
        observe: () => {
          throw new Error("detector exploded");
        },
      }
    : new AccountEventService({ events, wallet, actions: actionRows });
  const collection = new CollectionService({
    registry,
    connections,
    credentials,
    snapshots,
    leases,
    observer,
    now: clock,
  });
  const actions = new ActionService({
    enabled: () => enabled,
    registry,
    connections,
    credentials,
    snapshots,
    actions: actionRows,
    leases,
    collection,
  });
  const autoReset = new AutoResetService({
    automation,
    connections,
    snapshots,
    actionRows,
    events,
    actions,
  });
  const connection = connections.create({
    provider: "codex",
    identity: {
      providerAccountId: "acct-1",
      workspaceId: null,
      label: "Fake",
      assurance: "strong",
    },
    scope: "individual",
    authMethod: "cli_login",
    interface: "private",
    connectorVersion: "fake-1",
  });
  credentials.put(connection.id, credentialFixture());
  return {
    connector,
    connections,
    collection,
    autoReset,
    actionRows,
    events,
    automation,
    wallet,
    snapshots,
    connection,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    setNow: (value: number) => {
      now = value;
    },
    /** Queue a reading and collect it. */
    async read(result: CollectResult) {
      connector.collectQueue.push(result);
      return collection.run(connection.id);
    },
  };
}

const weeklyKey = "rate_limit.secondary_window";
const sessionKey = "rate_limit.primary_window";

function reading(
  observedAt: number,
  windows: { key: string; seconds: number; percent: number; resetsAt: number }[],
  resetCredits: ResetCreditObservation[] = [],
  extra: CollectResult["metrics"] = [],
): CollectResult {
  return {
    observedAt,
    metrics: [
      ...windows.map((w) => ({
        providerMetricKey: w.key,
        kind: "quota_percentage" as const,
        scope: `window:${w.seconds}s`,
        valueText: String(w.percent),
        unit: "percent",
        resetsAt: w.resetsAt,
        availability: "available" as const,
        interface: "private" as const,
      })),
      ...extra,
    ],
    resetCredits,
    failures: [],
  };
}
const weekly = (percent: number, resetsAt: number) => ({
  key: weeklyKey,
  seconds: week / 1000,
  percent,
  resetsAt,
});
const session = (percent: number, resetsAt: number) => ({
  key: sessionKey,
  seconds: 5 * 3600,
  percent,
  resetsAt,
});
const usable = (id: string, expiresAt: number | null = null): ResetCreditObservation => ({
  providerCreditId: id,
  eligible: true,
  usable: true,
  expiresAt,
});

const balanceMetric = (value: string): CollectResult["metrics"][number] => ({
  providerMetricKey: "credits.balance",
  kind: "credits",
  scope: "account",
  valueText: value,
  unit: "codex_credits",
  availability: "available",
  interface: "private",
});
const usdBalance = (value: string): CollectResult["metrics"][number] => ({
  providerMetricKey: "prepaid.balance",
  kind: "currency_balance",
  scope: "account",
  valueText: value,
  unit: "USD",
  availability: "available",
  interface: "private",
});
const inventoryMetric = (n: number): CollectResult["metrics"][number] => ({
  providerMetricKey: "reset_credits.available_count",
  kind: "reset_inventory",
  scope: "account",
  valueText: String(n),
  unit: "resets",
  availability: "available",
  interface: "private",
});

const rule: AutoResetRule = {
  enabled: true,
  window: "weekly",
  thresholdPercent: 100,
  minHoursLeft: 24,
  beforeExpiry: true,
  beforeExpiryMinutes: 2,
};

describe("account events from collection", () => {
  test("the first reading records nothing", async () => {
    const h = setup();
    await h.read(reading(base, [weekly(60, base + 3 * day)], [usable("a")]));
    expect(h.events.recent(new Date(0))).toEqual([]);
  });

  test("a detected top-up becomes a Wallet row first, then an event that names it", async () => {
    const h = setup();
    await h.read(reading(base, [], [], [balanceMetric("12")]));
    await h.read(reading(base + 1000, [], [], [balanceMetric("1012")]));
    const [event] = h.events.recent(new Date(0));
    const [topUp] = h.wallet.book().topUps;
    expect(topUp).toMatchObject({
      connectionId: h.connection.id,
      source: "detected",
      kind: "paid",
      price: null,
      credits: 1000,
      note: null,
      date: new Date(base + 1000).toISOString().slice(0, 10),
    });
    expect(event?.detail).toMatchObject({
      kind: "top_up_detected",
      added: 1000,
      topUpId: topUp?.id,
    });
    expect(event?.metricKey).toBe("credits.balance");
  });

  test("a reset granted between two readings is recorded", async () => {
    const h = setup();
    await h.read(reading(base, [], [usable("a")], [inventoryMetric(1)]));
    await h.read(
      reading(base + 1000, [], [usable("a"), usable("b", base + week)], [inventoryMetric(2)]),
    );
    expect(h.events.recent(new Date(0)).map((e) => e.detail)).toEqual([
      { kind: "reset_granted", creditId: "b", expiresAt: base + week, available: 2 },
    ]);
  });

  test("an early reset is recorded, unless an action since the previous reading explains it", async () => {
    const h = setup();
    await h.read(reading(base, [weekly(80, base + 3 * day)]));
    await h.read(reading(base + 1000, [weekly(1, base + 3 * day)]));
    expect(h.events.recent(new Date(0)).map((e) => e.detail.kind)).toEqual(["early_reset"]);

    const quiet = setup();
    await quiet.read(reading(base, [weekly(80, base + 3 * day)]));
    quiet.setNow(base + 500);
    const row = quiet.actionRows.create(quiet.connection.id, "consume_reset_credit");
    quiet.actionRows.complete(row.id, "uncertain");
    await quiet.read(reading(base + 1000, [weekly(1, base + 3 * day)]));
    expect(quiet.events.recent(new Date(0))).toEqual([]);

    const failed = setup();
    await failed.read(reading(base, [weekly(80, base + 3 * day)]));
    failed.setNow(base + 500);
    const failedRow = failed.actionRows.create(failed.connection.id, "consume_reset_credit");
    failed.actionRows.complete(failedRow.id, "failed");
    await failed.read(reading(base + 1000, [weekly(1, base + 3 * day)]));
    expect(failed.events.recent(new Date(0)).map((e) => e.detail.kind)).toEqual(["early_reset"]);
  });

  test("a failing detector never fails the collection", async () => {
    const h = setup({ observerThrows: true });
    await h.read(reading(base, [weekly(80, base + 3 * day)]));
    const outcome = await h.read(reading(base + 1000, [weekly(1, base + 3 * day)]));
    expect(outcome).toEqual({ status: "collected", outcome: "succeeded" });
    expect(h.snapshots.latest(h.connection.id)?.snapshot.observedAt.getTime()).toBe(base + 1000);
  });

  test("a Claude usage-credit rise is an event in USD with no Wallet row", async () => {
    const h = setup();
    await h.read(reading(base, [], [], [usdBalance("5.00")]));
    const observer = new AccountEventService({
      events: h.events,
      wallet: h.wallet,
      actions: h.actionRows,
    });
    observer.observe({
      connectionId: h.connection.id,
      provider: "claude",
      previous: h.snapshots.latest(h.connection.id),
      result: reading(base + 1000, [], [], [usdBalance("25.00")]),
    });
    expect(h.events.recent(new Date(0))[0]?.detail).toEqual({
      kind: "top_up_detected",
      unit: "USD",
      previous: 5,
      current: 25,
      added: 20,
      topUpId: null,
    });
    expect(h.wallet.book().topUps).toEqual([]);
  });

  test("a failing Wallet insert still records the event with no top-up id", async () => {
    const h = setup();
    h.wallet.addTopUp = () => {
      throw new Error("disk full");
    };
    await h.read(reading(base, [], [], [balanceMetric("1")]));
    await h.read(reading(base + 1000, [], [], [balanceMetric("11")]));
    expect(h.events.recent(new Date(0))[0]?.detail).toMatchObject({
      kind: "top_up_detected",
      topUpId: null,
    });
  });
});

async function armed(options: { rule?: AutoResetRule; credits?: ResetCreditObservation[] } = {}) {
  const h = setup();
  h.automation.setAutoReset(h.connection.id, options.rule ?? rule);
  await h.read(
    reading(base, [weekly(100, base + 3 * day)], options.credits ?? [usable("rc-1", base + week)]),
  );
  return h;
}
const actionCalls = (h: ReturnType<typeof setup>) =>
  h.connector.calls.filter((call) => call.startsWith("action:"));

describe("AutoResetService", () => {
  test("fires: uses the credit with origin automation and records an auto_reset event", async () => {
    const h = await armed();
    // The follow-up collection after the action reads the window back at 0.
    h.connector.collectQueue.push(reading(base + 60_000, [weekly(0, base + week)], []));
    const outcome = await h.autoReset.evaluate(h.connection.id, base);
    expect(outcome).toEqual({ status: "fired", state: "succeeded" });
    expect(actionCalls(h)).toHaveLength(1);
    expect(actionCalls(h)[0]).toContain("consume_reset_credit:rc-1");
    const [row] = h.actionRows.list(h.connection.id);
    expect(row?.origin).toBe("automation");
    expect(row?.state).toBe("succeeded");
    const events = h.events.recent(new Date(0));
    // The drop to 0 is explained by the action, so there is no early_reset.
    expect(events.map((e) => e.detail)).toEqual([
      {
        kind: "auto_reset",
        actionId: row?.id ?? "",
        state: "succeeded",
        creditId: "rc-1",
        percent: 100,
        resetsAt: base + 3 * day,
      },
    ]);
    expect(events[0]?.metricKey).toBe(weeklyKey);
  });

  test("does nothing below the threshold, and a lower threshold fires", async () => {
    const h = setup();
    h.automation.setAutoReset(h.connection.id, { ...rule, thresholdPercent: 95 });
    await h.read(reading(base, [weekly(94, base + 3 * day)], [usable("rc-1")]));
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "skipped",
      reason: "no_window",
    });
    expect(actionCalls(h)).toEqual([]);
    h.connector.collectQueue.push(
      reading(base + 1000, [weekly(95, base + 3 * day)], [usable("rc-1")]),
    );
    await h.collection.run(h.connection.id);
    expect((await h.autoReset.evaluate(h.connection.id, base)).status).toBe("fired");
  });

  test("does not fire when the window's own reset is too close", async () => {
    const h = setup();
    h.automation.setAutoReset(h.connection.id, rule);
    // Exactly 24 hours left is not more than 24 hours.
    await h.read(reading(base, [weekly(100, base + 24 * hour)], [usable("rc-1")]));
    expect((await h.autoReset.evaluate(h.connection.id, base)).status).toBe("skipped");
    expect(await h.autoReset.evaluate(h.connection.id, base - 1000)).toMatchObject({
      status: "fired",
    });
  });

  test("does not fire when account actions are switched off", async () => {
    const h = await armed();
    h.setEnabled(false);
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "skipped",
      reason: "actions_disabled",
    });
    expect(actionCalls(h)).toEqual([]);
    expect(h.actionRows.list(h.connection.id)).toEqual([]);
  });

  test("does not fire when the rule is disabled or missing", async () => {
    const h = await armed({ rule: { ...rule, enabled: false } });
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "skipped",
      reason: "rule_disabled",
    });
    h.automation.clearAutoReset(h.connection.id);
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "skipped",
      reason: "no_rule",
    });
    expect(actionCalls(h)).toEqual([]);
  });

  test("never fires on a paused connection", async () => {
    const h = await armed();
    h.connections.setPaused(h.connection.id, true);
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "skipped",
      reason: "not_ready",
    });
    expect(actionCalls(h)).toEqual([]);
  });

  test("does nothing without a usable credit", async () => {
    const h = setup();
    h.automation.setAutoReset(h.connection.id, rule);
    await h.read(
      reading(base, [weekly(100, base + 3 * day)], [{ ...usable("rc-1"), usable: false }]),
    );
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "skipped",
      reason: "no_credit",
    });
  });

  test("a failed attempt blocks a retry inside the same window instance", async () => {
    const h = await armed();
    h.connector.actionQueue.push({
      status: "failed",
      error: { category: "provider_unavailable", class: "transient", message: "down" },
    });
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "fired",
      state: "failed",
    });
    expect(h.events.recent(new Date(0))[0]?.detail).toMatchObject({
      kind: "auto_reset",
      state: "failed",
    });
    expect(await h.autoReset.evaluate(h.connection.id, base + hour)).toEqual({
      status: "skipped",
      reason: "already_attempted",
    });
    expect(actionCalls(h)).toHaveLength(1);
  });

  test("an uncertain attempt blocks a retry too", async () => {
    const h = await armed();
    h.connector.actionQueue.push({
      status: "uncertain",
      error: { category: "provider_unavailable", class: "transient", message: "timeout" },
    });
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "fired",
      state: "uncertain",
    });
    expect((await h.autoReset.evaluate(h.connection.id, base + hour)).status).toBe("skipped");
    expect(actionCalls(h)).toHaveLength(1);
  });

  test("with either, a failed weekly attempt also blocks a spent 5-hour window", async () => {
    const h = setup();
    h.automation.setAutoReset(h.connection.id, { ...rule, window: "either", minHoursLeft: 1 });
    await h.read(reading(base, [weekly(100, base + 3 * day)], [usable("rc-1", base + week)]));
    h.connector.actionQueue.push({
      status: "failed",
      error: { category: "provider_unavailable", class: "transient", message: "down" },
    });
    expect((await h.autoReset.evaluate(h.connection.id, base)).status).toBe("fired");
    // Six hours later the weekly limit is still spent and a fresh 5-hour window is spent too.
    const later = base + 6 * hour;
    h.setNow(later);
    await h.read(
      reading(
        later,
        [weekly(100, base + 3 * day), session(100, later + 4 * hour)],
        [usable("rc-1", base + week)],
      ),
    );
    expect(await h.autoReset.evaluate(h.connection.id, later)).toEqual({
      status: "skipped",
      reason: "already_attempted",
    });
    expect(actionCalls(h)).toHaveLength(1);
  });

  test("after a success the next window instance may fire again", async () => {
    const h = await armed({ credits: [usable("rc-1"), usable("rc-2")] });
    // The reset worked, then the next window filled up again.
    h.connector.collectQueue.push(
      reading(base + 60_000, [weekly(100, base + 10 * day)], [usable("rc-2")]),
    );
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "fired",
      state: "succeeded",
    });
    h.setNow(base + 61_000);
    h.connector.collectQueue.push(
      reading(base + 120_000, [weekly(100, base + 10 * day)], [usable("rc-2")]),
    );
    expect(await h.autoReset.evaluate(h.connection.id, base + 120_000)).toEqual({
      status: "fired",
      state: "succeeded",
    });
    expect(actionCalls(h)).toHaveLength(2);
  });

  test("picks the usable credit that expires first, and one with no expiry last", async () => {
    const h = await armed({
      credits: [usable("none", null), usable("late", base + 9 * day), usable("soon", base + day)],
    });
    await h.autoReset.evaluate(h.connection.id, base);
    expect(actionCalls(h)[0]).toContain("consume_reset_credit:soon");

    const only = await armed({ credits: [usable("none", null)] });
    await only.autoReset.evaluate(only.connection.id, base);
    expect(actionCalls(only)[0]).toContain("consume_reset_credit:none");
  });

  test("weekly watches windows of 7 days or more, session those of 5 hours or less, either both", async () => {
    const windows = [session(100, base + 3 * hour), weekly(100, base + 3 * day)];
    const run = async (window: AutoResetRule["window"], list = windows) => {
      const h = setup();
      h.automation.setAutoReset(h.connection.id, { ...rule, window, minHoursLeft: 1 });
      await h.read(reading(base, list, [usable("rc-1")]));
      await h.autoReset.evaluate(h.connection.id, base);
      return h.events.recent(new Date(0)).map((e) => e.metricKey);
    };
    expect(await run("weekly")).toEqual([weeklyKey]);
    expect(await run("session")).toEqual([sessionKey]);
    // Either prefers the longer window when both qualify.
    expect(await run("either")).toEqual([weeklyKey]);
    // A weekly rule ignores a session-only exhaustion.
    expect(
      await run("weekly", [session(100, base + 3 * hour), weekly(40, base + 3 * day)]),
    ).toEqual([]);
    // A window of 2 days is neither weekly nor session.
    const odd = [{ key: weeklyKey, seconds: 2 * 86_400, percent: 100, resetsAt: base + day }];
    expect(await run("either", odd)).toEqual([]);
  });

  test("model-specific limits are not watched", async () => {
    const h = setup();
    h.automation.setAutoReset(h.connection.id, rule);
    await h.read(
      reading(
        base,
        [
          {
            key: "additional.GPT-5.secondary_window",
            seconds: week / 1000,
            percent: 100,
            resetsAt: base + 3 * day,
          },
        ],
        [usable("rc-1")],
      ),
    );
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "skipped",
      reason: "no_window",
    });
  });

  test("an unknown percent is not read as exhausted", async () => {
    const h = setup();
    h.automation.setAutoReset(h.connection.id, rule);
    const result = reading(base, [weekly(100, base + 3 * day)], [usable("rc-1")]);
    await h.read({
      ...result,
      metrics: result.metrics.map((m) =>
        Object.assign({}, m, { valueText: null, availability: "unknown" as const }),
      ),
    });
    expect((await h.autoReset.evaluate(h.connection.id, base)).status).toBe("skipped");
  });
});

const minute = 60_000;
const failed: ActionResult = {
  status: "failed",
  error: { category: "provider_unavailable", class: "transient", message: "down" },
};
/** A credit that expires at `expiresAt`, read at `at` with the weekly limit 10% used. */
const expiring = (at: number, expiresAt: number, id = "rc-1") =>
  reading(at, [weekly(10, base + 3 * day)], [usable(id, expiresAt)]);
/** One scheduler tick at `at`: collect when the service asks for a reading, then run the trigger. */
const tick = async (h: ReturnType<typeof setup>, at: number, fresh: CollectResult | Error) => {
  h.setNow(at);
  if (h.autoReset.wantsReading(h.connection.id, at)) {
    h.connector.collectQueue.push(fresh);
    await h.collection.run(h.connection.id);
  }
  return h.autoReset.beforeExpiry(h.connection.id, at);
};

describe("AutoResetService.beforeExpiry", () => {
  test("with no stored rule, uses a credit expiring within 2 minutes", async () => {
    const h = setup();
    const expiresAt = base + 90_000;
    await h.read(expiring(base, expiresAt));
    // The reading is fresh, so no other is needed.
    expect(h.autoReset.wantsReading(h.connection.id, base)).toBe(false);
    expect(await h.autoReset.beforeExpiry(h.connection.id, base)).toEqual({
      status: "fired",
      state: "succeeded",
    });
    const [row] = h.actionRows.list(h.connection.id);
    // Its own origin, so it is not the limit trigger's one attempt per window.
    expect(row?.origin).toBe("expiry");
    const event = h.events.recent(new Date(0)).find((e) => e.detail.kind === "auto_reset");
    expect(event?.metricKey).toBe(weeklyKey);
    expect(event?.detail).toEqual({
      kind: "auto_reset",
      actionId: row?.id ?? "",
      state: "succeeded",
      creditId: "rc-1",
      percent: 10,
      resetsAt: base + 3 * day,
      trigger: "expiry",
      creditExpiresAt: expiresAt,
    });
  });

  test("asks for a fresh reading when the last one is over a minute old, and acts on it", async () => {
    const h = setup();
    const expiresAt = base + 5 * minute;
    await h.read(expiring(base, expiresAt));
    const at = base + 4 * minute;
    expect(h.autoReset.wantsReading(h.connection.id, at)).toBe(true);
    // Without that reading nothing is sent.
    h.setNow(at);
    expect(await h.autoReset.beforeExpiry(h.connection.id, at)).toEqual({
      status: "skipped",
      reason: "no_fresh_reading",
    });
    const later = at + expiryRetryBaseMs;
    expect((await tick(h, later, expiring(later, expiresAt))).status).toBe("fired");
    expect(actionCalls(h)).toHaveLength(1);
  });

  test("waits until the credit is inside the lead time", async () => {
    const h = setup();
    await h.read(expiring(base, base + 3 * minute));
    expect(h.autoReset.wantsReading(h.connection.id, base)).toBe(false);
    expect(await h.autoReset.beforeExpiry(h.connection.id, base)).toEqual({
      status: "skipped",
      reason: "no_credit",
    });
    expect(actionCalls(h)).toEqual([]);
  });

  test("a fresh reading that moved the expiry out of the lead time stops the attempt", async () => {
    const h = setup();
    await h.read(expiring(base, base + minute));
    const at = base + 2 * expiryFreshMs;
    // The credit now expires in a week.
    expect(await tick(h, at, expiring(at, base + week))).toEqual({
      status: "skipped",
      reason: "no_credit",
    });
    expect(actionCalls(h)).toEqual([]);
  });

  test("follows the owner's lead time and switch", async () => {
    const h = setup();
    h.automation.setAutoReset(h.connection.id, { ...rule, beforeExpiryMinutes: 10 });
    await h.read(expiring(base, base + 9 * minute));
    expect((await h.autoReset.beforeExpiry(h.connection.id, base)).status).toBe("fired");

    const off = setup();
    off.automation.setAutoReset(off.connection.id, { ...rule, beforeExpiry: false });
    await off.read(expiring(base, base + minute));
    expect(off.autoReset.wantsReading(off.connection.id, base + 2 * expiryFreshMs)).toBe(false);
    expect(await off.autoReset.beforeExpiry(off.connection.id, base)).toEqual({
      status: "skipped",
      reason: "expiry_disabled",
    });
  });

  test("does nothing while account actions are switched off", async () => {
    const h = setup({ enabled: false });
    await h.read(expiring(base, base + minute));
    expect(await h.autoReset.beforeExpiry(h.connection.id, base)).toEqual({
      status: "skipped",
      reason: "actions_disabled",
    });
    expect(actionCalls(h)).toEqual([]);
  });

  test("ignores a credit that has already expired or has no expiry", async () => {
    const h = setup();
    await h.read(
      reading(base, [weekly(10, base + 3 * day)], [usable("gone", base), usable("forever", null)]),
    );
    expect((await h.autoReset.beforeExpiry(h.connection.id, base)).status).toBe("skipped");
    expect(actionCalls(h)).toEqual([]);
  });

  test("retries a failed attempt with a doubling wait until the credit expires", async () => {
    const h = setup();
    const expiresAt = base + 2 * minute;
    await h.read(expiring(base, expiresAt));
    const tries: number[] = [];
    for (let at = base; at < expiresAt; at += 10_000) {
      h.connector.actionQueue.push(failed);
      // eslint-disable-next-line no-await-in-loop -- one tick at a time, like the scheduler
      const outcome = await tick(h, at, expiring(at, expiresAt));
      if (outcome.status === "fired") tries.push(at - base);
      else expect(outcome).toEqual({ status: "skipped", reason: "backing_off" });
      h.connector.actionQueue.length = 0;
    }
    const b = expiryRetryBaseMs;
    expect(tries).toEqual([0, b, b + 2 * b]);
    // Past the expiry nothing more is tried.
    expect((await tick(h, expiresAt, expiring(expiresAt, expiresAt))).status).toBe("skipped");
    expect(actionCalls(h)).toHaveLength(3);
  });

  test("an unconfirmed attempt is not repeated once a fresh reading shows the credit gone", async () => {
    const h = setup();
    const expiresAt = base + 2 * minute;
    await h.read(expiring(base, expiresAt));
    h.connector.actionQueue.push({
      status: "uncertain",
      error: { category: "provider_unavailable", class: "transient", message: "timeout" },
    });
    expect(await tick(h, base, expiring(base, expiresAt))).toEqual({
      status: "fired",
      state: "uncertain",
    });
    const later = base + 2 * expiryFreshMs;
    expect(await tick(h, later, reading(later, [weekly(0, base + week)]))).toEqual({
      status: "skipped",
      reason: "no_credit",
    });
    expect(actionCalls(h)).toHaveLength(1);
  });

  test("a failed reading counts as a try, so a provider that is down is not read every tick", async () => {
    const h = setup();
    const at = base + 2 * expiryFreshMs;
    const expiresAt = at + minute;
    await h.read(expiring(base, expiresAt));
    expect(await tick(h, at, new Error("network"))).toEqual({
      status: "skipped",
      reason: "no_fresh_reading",
    });
    expect(h.autoReset.wantsReading(h.connection.id, at + expiryRetryBaseMs - 1)).toBe(false);
    expect(h.autoReset.wantsReading(h.connection.id, at + expiryRetryBaseMs)).toBe(true);
    expect(actionCalls(h)).toEqual([]);
  });

  test("a retry needs a reading taken after the previous attempt", async () => {
    const h = setup();
    const expiresAt = base + 2 * minute;
    await h.read(expiring(base, expiresAt));
    h.connector.actionQueue.push({
      status: "uncertain",
      error: { category: "provider_unavailable", class: "transient", message: "timeout" },
    });
    expect((await h.autoReset.beforeExpiry(h.connection.id, base)).status).toBe("fired");
    // 30 seconds later the reading from before the attempt is still under a minute old.
    const later = base + expiryRetryBaseMs;
    h.setNow(later);
    expect(h.autoReset.wantsReading(h.connection.id, later)).toBe(true);
    expect(await h.autoReset.beforeExpiry(h.connection.id, later)).toEqual({
      status: "skipped",
      reason: "no_fresh_reading",
    });
    expect(actionCalls(h)).toHaveLength(1);
  });

  test("does not try a credit again in the tick the limit trigger just tried it", async () => {
    const h = setup();
    h.automation.setAutoReset(h.connection.id, { ...rule, minHoursLeft: 1 });
    await h.read(reading(base, [weekly(100, base + 3 * day)], [usable("rc-1", base + minute)]));
    h.connector.actionQueue.push(failed);
    expect(await h.autoReset.evaluate(h.connection.id, base)).toEqual({
      status: "fired",
      state: "failed",
    });
    expect(await h.autoReset.beforeExpiry(h.connection.id, base)).toEqual({
      status: "skipped",
      reason: "no_fresh_reading",
    });
    expect(actionCalls(h)).toHaveLength(1);
  });

  test("waits out the provider's Retry-After when it is longer than the backoff", async () => {
    const h = setup();
    const expiresAt = base + 2 * minute;
    await h.read(expiring(base, expiresAt));
    h.connector.actionQueue.push({
      status: "failed",
      error: {
        category: "rate_limited",
        class: "transient",
        message: "429",
        retryAfterMs: 90_000,
      },
    });
    expect(await tick(h, base, expiring(base, expiresAt))).toEqual({
      status: "fired",
      state: "failed",
      retryAfterMs: 90_000,
    });
    const early = base + 60_000;
    expect(await tick(h, early, expiring(early, expiresAt))).toEqual({
      status: "skipped",
      reason: "backing_off",
    });
    const due = base + 90_000;
    expect((await tick(h, due, expiring(due, expiresAt))).status).toBe("fired");
    expect(actionCalls(h)).toHaveLength(2);
  });

  test("a partial reading counts as fresh", async () => {
    const h = setup();
    const partial: CollectResult = {
      ...expiring(base, base + minute),
      failures: [{ category: "provider_unavailable", class: "transient", message: "one metric" }],
    };
    await h.read(partial);
    expect(h.snapshots.latestRun(h.connection.id)?.outcome).toBe("partial");
    expect((await h.autoReset.beforeExpiry(h.connection.id, base)).status).toBe("fired");
  });

  test("uses the credit that expires first when two are inside the lead time", async () => {
    const h = setup();
    await h.read(
      reading(
        base,
        [weekly(10, base + 3 * day)],
        [usable("later", base + 100_000), usable("sooner", base + 50_000)],
      ),
    );
    await h.autoReset.beforeExpiry(h.connection.id, base);
    expect(actionCalls(h)[0]).toContain("consume_reset_credit:sooner");
  });

  test("a failed use-before-expiry attempt does not block the limit rule", async () => {
    const h = setup();
    h.automation.setAutoReset(h.connection.id, rule);
    const credits = [usable("soon", base + minute), usable("later", base + week)];
    await h.read(reading(base, [weekly(10, base + 3 * day)], credits));
    h.connector.actionQueue.push(failed);
    expect((await h.autoReset.beforeExpiry(h.connection.id, base)).status).toBe("fired");
    const later = base + hour;
    h.setNow(later);
    await h.read(reading(later, [weekly(100, base + 3 * day)], [usable("later", base + week)]));
    expect(await h.autoReset.evaluate(h.connection.id, later)).toEqual({
      status: "fired",
      state: "succeeded",
    });
  });
});
