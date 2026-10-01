import { describe, expect, test } from "bun:test";

import { ActionStore } from "../actions.ts";
import { CredentialStore } from "../credentials.ts";
import { createKeyring, generateKeyHex, parseKeyHex } from "../crypto/index.ts";
import { openDatabase } from "../db/index.ts";
import { LeaseStore } from "../leases.ts";
import { AttemptStore, ConnectionStore } from "../lifecycle.ts";
import { SnapshotStore } from "../snapshots.ts";
import {
  type ActionNotAllowedError,
  ActionNotConfirmedError,
  ActionsDisabledError,
  ActionService,
  UnsupportedActionError,
} from "./actions.ts";
import { CollectionService } from "./collect.ts";
import { ConnectService } from "./connect.ts";
import { credentialFixture, FakeConnector } from "./fake-connector.ts";

function setup(enabled: boolean) {
  const { db } = openDatabase({ path: ":memory:" });
  let now = 1_700_000_000_000;
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
  const actions = new ActionStore(db, clock);
  const collection = new CollectionService({
    registry,
    connections,
    credentials,
    snapshots,
    leases,
    now: clock,
  });
  const connect = new ConnectService({
    registry,
    attempts: new AttemptStore(db, keyring, clock),
    connections,
    credentials,
    snapshots,
    now: clock,
  });
  const service = new ActionService({
    enabled,
    registry,
    connections,
    credentials,
    snapshots,
    actions,
    leases,
    collection,
  });
  return {
    service,
    connector,
    connect,
    actions,
    leases,
    snapshots,
    advance: (ms: number) => (now += ms),
  };
}

/** Resolve with the rejection so the assertion itself never awaits a non-thenable. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

function withCredit(id: string, usable: boolean) {
  return {
    observedAt: 1_700_000_000_000,
    metrics: [],
    resetCredits: [
      { providerCreditId: id, eligible: usable, usable, expiresAt: 1_700_900_000_000 },
    ],
    failures: [],
  };
}

async function connected(s: ReturnType<typeof setup>, credit = withCredit("credit-1", true)) {
  s.connector.collectQueue.push(credit);
  s.connector.beginQueue.push({ status: "credentials", credential: credentialFixture() });
  const attempt = await s.connect.begin({ provider: "codex", method: "import" });
  return attempt.connectionId!;
}

describe("ActionService", () => {
  test("refuses when actions are switched off, and before that nothing is recorded", async () => {
    const s = setup(false);
    const id = await connected(s);
    expect(
      await rejection(
        s.service.perform({
          connectionId: id,
          action: "consume_reset_credit",
          creditId: "credit-1",
          confirm: true,
        }),
      ),
    ).toBeInstanceOf(ActionsDisabledError);
    expect(s.actions.list(id)).toHaveLength(0);
    expect(s.connector.calls.some((c) => c.startsWith("action:"))).toBe(false);
  });

  test("requires confirmation, a usable credit from the latest snapshot, and a connector that supports the action", async () => {
    const s = setup(true);
    const id = await connected(s);
    expect(
      await rejection(
        s.service.perform({
          connectionId: id,
          action: "consume_reset_credit",
          creditId: "credit-1",
          confirm: false,
        }),
      ),
    ).toBeInstanceOf(ActionNotConfirmedError);
    expect(
      await rejection(
        s.service.perform({ connectionId: id, action: "consume_reset_credit", confirm: true }),
      ),
    ).toMatchObject({ reason: "credit_required" } satisfies Partial<ActionNotAllowedError>);
    expect(
      await rejection(
        s.service.perform({
          connectionId: id,
          action: "consume_reset_credit",
          creditId: "nope",
          confirm: true,
        }),
      ),
    ).toMatchObject({
      reason: "credit_not_usable",
    } satisfies Partial<ActionNotAllowedError>);
    expect(s.actions.list(id)).toHaveLength(0);

    const other = setup(true);
    const otherId = await connected(other);
    (other.connector as { supportedActions: readonly string[] }).supportedActions = [];
    expect(
      await rejection(
        other.service.perform({
          connectionId: otherId,
          action: "consume_reset_credit",
          creditId: "credit-1",
          confirm: true,
        }),
      ),
    ).toBeInstanceOf(UnsupportedActionError);
  });

  test("a confirmed consume creates the row first, uses its id as idempotency key, then collects again", async () => {
    const s = setup(true);
    const id = await connected(s);
    s.connector.collectQueue.push(withCredit("credit-1", false));
    const outcome = await s.service.perform({
      connectionId: id,
      action: "consume_reset_credit",
      creditId: "credit-1",
      confirm: true,
    });
    expect(outcome.action.state).toBe("succeeded");
    expect(outcome.action.idempotencyKey).toBe(outcome.action.id);
    expect(outcome.action.providerReference).toBe("credit-1");
    expect(outcome.collection).toMatchObject({ status: "collected" });
    expect(s.connector.calls).toContain(
      `action:consume_reset_credit:credit-1:${outcome.action.id}`,
    );
    // The follow-up collection ran after the action and refreshed the credit list.
    expect(s.connector.calls.filter((c) => c === "collect")).toHaveLength(2);
    expect(s.snapshots.latest(id)?.resetCredits[0]?.usable).toBe(false);
    expect(outcome.action.resultingSnapshotId).toBe(s.snapshots.latest(id)?.snapshot.id ?? null);
  });

  test("failed and uncertain results are recorded as such and no collection follows", async () => {
    const s = setup(true);
    const id = await connected(s);
    s.connector.actionQueue.push({
      status: "failed",
      error: {
        category: "permission_denied",
        class: "capability",
        message: "consume returned 403",
      },
    });
    const failed = await s.service.perform({
      connectionId: id,
      action: "consume_reset_credit",
      creditId: "credit-1",
      confirm: true,
    });
    expect(failed.action.state).toBe("failed");
    expect(failed.action.sanitizedError).toContain("403");
    expect(failed.collection).toBeUndefined();

    // A thrown error from the connector is uncertain: the request may have left.
    const original = s.connector.performAction.bind(s.connector);
    s.connector.performAction = () => Promise.reject(new Error("socket hang up"));
    const uncertain = await s.service.perform({
      connectionId: id,
      action: "consume_reset_credit",
      creditId: "credit-1",
      confirm: true,
    });
    s.connector.performAction = original;
    expect(uncertain.action.state).toBe("uncertain");
    expect(
      s.actions
        .list(id)
        .map((row) => row.state)
        .toSorted(),
    ).toEqual(["failed", "uncertain"]);
    expect(s.connector.calls.filter((c) => c === "collect")).toHaveLength(1);
  });

  test("a held lease ends the action as failed without calling the provider", async () => {
    const s = setup(true);
    const id = await connected(s);
    s.leases.acquire(id, "collect:other", 60_000);
    const outcome = await s.service.perform({
      connectionId: id,
      action: "consume_reset_credit",
      creditId: "credit-1",
      confirm: true,
    });
    expect(outcome.action.state).toBe("failed");
    expect(outcome.action.sanitizedError).toContain("nothing was sent");
    expect(s.connector.calls.some((c) => c.startsWith("action:"))).toBe(false);
  });
});
