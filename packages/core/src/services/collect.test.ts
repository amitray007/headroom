import { ConnectorError } from "../connector.ts";
import { describe, expect, test } from "bun:test";

import { CredentialStore } from "../credentials.ts";
import { createKeyring, generateKeyHex, parseKeyHex } from "../crypto/index.ts";
import { openDatabase } from "../db/index.ts";
import { LeaseStore } from "../leases.ts";
import { ConnectionStore } from "../lifecycle.ts";
import { SnapshotStore } from "../snapshots.ts";
import { CollectionService } from "./collect.ts";
import {
  authError,
  credentialFixture,
  FakeConnector,
  okCollect,
  rateLimitError,
} from "./fake-connector.ts";

function setup() {
  const { db } = openDatabase({ path: ":memory:" });
  let now = 1_700_000_000_000;
  const clock = () => new Date(now);
  const keyring = createKeyring({ 1: parseKeyHex(generateKeyHex()) });
  const connector = new FakeConnector("codex");
  const connections = new ConnectionStore(db, clock);
  const credentials = new CredentialStore(db, keyring);
  const snapshots = new SnapshotStore(db, clock);
  const leases = new LeaseStore(db, clock);
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
  const service = new CollectionService({
    registry: { get: (p) => (p === "codex" ? connector : undefined), list: () => [connector] },
    connections,
    credentials,
    snapshots,
    leases,
    now: clock,
    refreshLeadMs: 5 * 60_000,
  });
  return {
    service,
    connector,
    connections,
    credentials,
    snapshots,
    leases,
    connection,
    advance: (ms: number) => (now += ms),
  };
}

/** A definitive failure other than a rejected credential. */
const mismatch = () => new ConnectorError("identity_mismatch", "a different account answered");

describe("CollectionService", () => {
  test("a healthy run records a snapshot, marks success and does not refresh early", async () => {
    const { service, connector, connections, snapshots, connection } = setup();
    const outcome = await service.run(connection.id);
    expect(outcome).toEqual({ status: "collected", outcome: "succeeded" });
    expect(connector.calls).toEqual(["collect"]);
    expect(connections.get(connection.id)?.lastSuccessAt?.getTime()).toBe(okCollect().observedAt);
    expect(snapshots.latest(connection.id)?.metrics[0]?.valueText).toBe("42.5");
    expect(snapshots.latestRun(connection.id)?.outcome).toBe("succeeded");
  });

  test("refreshes proactively inside the lead window and persists the rotated credential first", async () => {
    const { service, connector, credentials, connection, advance } = setup();
    advance(credentialFixture().expiresAt! - 1_700_000_000_000 - 60_000);
    const outcome = await service.run(connection.id);
    expect(outcome.status).toBe("collected");
    expect(connector.calls).toEqual(["refresh", "collect"]);
    expect(credentials.get(connection.id)?.secret).toEqual(credentialFixture("refreshed").secret);
  });

  test("a 401 triggers one refresh and one retry; a second 401 is definitive", async () => {
    const { service, connector, connections, connection, snapshots } = setup();
    connector.collectQueue.push(authError(), okCollect("7"));
    expect((await service.run(connection.id)).status).toBe("collected");
    expect(connector.calls).toEqual(["collect", "refresh", "collect"]);
    expect(connections.get(connection.id)?.state).toBe("ready");

    connector.calls.length = 0;
    connector.collectQueue.push(authError(), authError(), authError(), authError());
    // First rejection of a key that worked before is only a strike.
    expect((await service.run(connection.id)).status).toBe("failed");
    expect(connections.get(connection.id)?.state).toBe("ready");
    const failed = await service.run(connection.id);
    expect(failed.status).toBe("failed");
    expect(connections.get(connection.id)?.state).toBe("reconnect_required");
    expect(connections.get(connection.id)?.reconnectReason).toBe("token_rejected");
    expect(snapshots.latestRun(connection.id)?.outcome).toBe("authentication_failed");
    // The earlier snapshot is still the latest one, with its original observation time.
    expect(snapshots.latest(connection.id)?.metrics[0]?.valueText).toBe("7");
  });

  test("a first rejection on a connection that worked is re-checked, not disconnected", async () => {
    const { service, connector, connections, connection, snapshots } = setup();
    await service.run(connection.id);
    connector.collectQueue.push(authError(), authError());
    const outcome = await service.run(connection.id);
    expect(outcome).toMatchObject({
      status: "failed",
      outcome: "authentication_failed",
      error: { class: "transient" },
    });
    expect(connections.get(connection.id)?.state).toBe("ready");
    const run = snapshots.latestRun(connection.id);
    expect(run?.outcome).toBe("authentication_failed");
    expect(run?.retryAfter?.getTime()).toBe(1_700_000_000_000 + 2 * 60_000);
  });

  test("a second consecutive rejection disconnects with token_rejected", async () => {
    const { service, connector, connections, connection } = setup();
    await service.run(connection.id);
    connector.collectQueue.push(authError(), authError(), authError(), authError());
    await service.run(connection.id);
    await service.run(connection.id);
    expect(connections.get(connection.id)?.state).toBe("reconnect_required");
    expect(connections.get(connection.id)?.reconnectReason).toBe("token_rejected");
  });

  test("a rejection after an intervening success starts over at strike one", async () => {
    const { service, connector, connections, connection } = setup();
    await service.run(connection.id);
    connector.collectQueue.push(authError(), authError(), okCollect("8"), authError(), authError());
    await service.run(connection.id);
    expect((await service.run(connection.id)).status).toBe("collected");
    await service.run(connection.id);
    expect(connections.get(connection.id)?.state).toBe("ready");
  });

  test("any definitive failure that repeats disconnects instead of re-checking forever", async () => {
    const { service, connector, connections, connection } = setup();
    await service.run(connection.id);
    connector.collectQueue.push(mismatch(), mismatch());
    await service.run(connection.id);
    expect(connections.get(connection.id)?.state).toBe("ready");
    await service.run(connection.id);
    expect(connections.get(connection.id)?.state).toBe("reconnect_required");
  });

  test("a connection that never succeeded disconnects on the first rejection", async () => {
    const { service, connector, connections, connection } = setup();
    connector.collectQueue.push(authError(), authError());
    await service.run(connection.id);
    expect(connections.get(connection.id)?.state).toBe("reconnect_required");
    expect(connections.get(connection.id)?.reconnectReason).toBe("token_rejected");
  });

  test("a rejected refresh is definitive with refresh_rejected", async () => {
    const { service, connector, connections, credentials, connection, advance } = setup();
    advance(60 * 60_000);
    connector.refreshQueue.push({
      status: "rejected",
      error: { category: "authentication_required", class: "definitive", message: "invalid_grant" },
    });
    const outcome = await service.run(connection.id);
    expect(outcome.status).toBe("failed");
    expect(connections.get(connection.id)?.reconnectReason).toBe("refresh_rejected");
    expect(credentials.get(connection.id)?.refreshState).toBe("refresh_failed");
    expect(connector.calls).toEqual(["refresh"]);
  });

  test("transient failures record the run and leave the connection alone", async () => {
    const { service, connector, connections, connection, snapshots } = setup();
    connector.collectQueue.push(rateLimitError());
    const outcome = await service.run(connection.id);
    expect(outcome).toMatchObject({ status: "failed", outcome: "rate_limited" });
    expect(connections.get(connection.id)?.state).toBe("ready");
    const run = snapshots.latestRun(connection.id);
    expect(run?.retryAfter?.getTime()).toBe(1_700_000_000_000 + 30_000);
    expect(run?.sanitizedError).toBe("rate_limited: 429");
  });

  test("not refreshable credentials skip refresh and fail definitively on 401", async () => {
    const { service, connector, connections, credentials, connection } = setup();
    credentials.put(connection.id, { secret: { key: "k" }, expiresAt: null }, "not_refreshable");
    connector.collectQueue.push(authError());
    await service.run(connection.id);
    expect(connector.calls).toEqual(["collect"]);
    expect(connections.get(connection.id)?.state).toBe("reconnect_required");
  });

  test("paused, reconnect_required and leased connections are skipped", async () => {
    const { service, connections, leases, connection } = setup();
    connections.setPaused(connection.id, true);
    expect(await service.run(connection.id)).toEqual({
      status: "skipped",
      reason: "not_collectable",
    });
    connections.setPaused(connection.id, false);
    leases.acquire(connection.id, "someone-else", 60_000);
    expect(await service.run(connection.id)).toEqual({ status: "skipped", reason: "lease_held" });
  });
});
