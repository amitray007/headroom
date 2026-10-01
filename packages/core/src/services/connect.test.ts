import { describe, expect, test } from "bun:test";

import { ConnectorError } from "../connector.ts";
import { CredentialStore } from "../credentials.ts";
import { createKeyring, generateKeyHex, parseKeyHex } from "../crypto/index.ts";
import { openDatabase } from "../db/index.ts";
import { AttemptStore, ConnectionStore } from "../lifecycle.ts";
import { SnapshotStore } from "../snapshots.ts";
import { ConnectService, InvalidAttemptStateError, ProviderDisabledError } from "./connect.ts";
import { credentialFixture, FakeConnector, partialCollect } from "./fake-connector.ts";

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

function setup() {
  const { db } = openDatabase({ path: ":memory:" });
  let now = 1_700_000_000_000;
  const clock = () => new Date(now);
  const keyring = createKeyring({ 1: parseKeyHex(generateKeyHex()) });
  const connector = new FakeConnector("codex");
  const connections = new ConnectionStore(db, clock);
  const credentials = new CredentialStore(db, keyring);
  const snapshots = new SnapshotStore(db, clock);
  const service = new ConnectService({
    registry: { get: (p) => (p === "codex" ? connector : undefined), list: () => [connector] },
    attempts: new AttemptStore(db, keyring, clock),
    connections,
    credentials,
    snapshots,
    now: clock,
    attemptTtlMs: 60_000,
  });
  return {
    service,
    connector,
    connections,
    credentials,
    snapshots,
    advance: (ms: number) => (now += ms),
  };
}

describe("ConnectService", () => {
  test("device flow: begin shows a code, poll waits, then credentials create a ready connection", async () => {
    const { service, connector, connections, credentials, snapshots, advance } = setup();
    const begun = await service.begin({ provider: "codex", method: "device_code" });
    expect(begun.state).toBe("awaiting_user");
    expect(begun.nextStep?.kind).toBe("device_code");
    expect(begun.pollAfterMs).toBeGreaterThan(0);

    const waiting = await service.poll(begun.id);
    expect(waiting.state).toBe("awaiting_user");
    expect(connector.calls.filter((c) => c === "poll")).toHaveLength(1);
    // Within the connector's poll interval the service does not ask the provider again.
    await service.poll(begun.id);
    expect(connector.calls.filter((c) => c === "poll")).toHaveLength(1);

    advance(5_001);
    connector.pollQueue.push({ status: "credentials", credential: credentialFixture() });
    const done = await service.poll(begun.id);
    expect(done.state).toBe("succeeded");
    expect(done.connectionId).not.toBeNull();
    const connection = connections.get(done.connectionId!)!;
    expect(connection.state).toBe("ready");
    expect(credentials.get(connection.id)?.secret).toEqual(credentialFixture().secret);
    expect(snapshots.latest(connection.id)?.metrics).toHaveLength(1);
    expect(connector.calls).toEqual([
      "begin:device_code",
      "poll",
      "poll",
      "identity",
      "capabilities",
      "collect",
    ]);
  });

  test("api key flow: submit input validates and records capabilities, snapshot and partial state", async () => {
    const { service, connector, connections, snapshots } = setup();
    connector.beginQueue.push({
      status: "next_step",
      nextStep: {
        kind: "api_key",
        keyPageUrl: "https://example.com/keys",
        fields: [{ name: "key", label: "API key", secret: true }],
      },
      privateState: null,
    });
    connector.collectQueue.push(partialCollect());
    const begun = await service.begin({ provider: "codex", method: "api_key" });
    expect(begun.state).toBe("awaiting_input");
    const done = await service.submit(begun.id, { kind: "api_key", values: { key: "k" } });
    expect(done.state).toBe("succeeded");
    const connection = connections.get(done.connectionId!)!;
    expect(connection.state).toBe("partial");
    expect(snapshots.capabilities(connection.id)).toHaveLength(1);
    const latest = snapshots.latest(connection.id)!;
    expect(latest.metrics.map((m) => m.availability).toSorted()).toEqual([
      "available",
      "not_authorized",
    ]);
    expect(latest.resetCredits).toHaveLength(1);
    expect(snapshots.latestRun(connection.id)?.outcome).toBe("partial");
  });

  test("a step awaiting input is polled when the connector asks, and may finish without input", async () => {
    const { service, connector, advance } = setup();
    connector.beginQueue.push({
      status: "next_step",
      nextStep: {
        kind: "paste_redirect",
        url: "https://example.com/authorize",
        expiresAt: 1_700_000_060_000,
        accepts: "url_or_code",
      },
      privateState: { attemptId: "cli-1" },
      pollAfterMs: 2000,
    });
    const begun = await service.begin({ provider: "codex", method: "api_key" });
    expect(begun.state).toBe("awaiting_input");
    expect(begun.pollAfterMs).toBeGreaterThan(0);
    // Inside the connector's interval the provider is left alone.
    await service.poll(begun.id);
    expect(connector.calls).not.toContain("poll");
    advance(2500);
    const stillWaiting = await service.poll(begun.id);
    expect(stillWaiting.state).toBe("awaiting_input");
    expect(stillWaiting.nextStep?.kind).toBe("paste_redirect");
    expect(connector.calls.filter((c) => c === "poll")).toHaveLength(1);
    // The fake answered "waiting" with a five-second interval; the next poll after it finds credentials.
    advance(5500);
    connector.pollQueue.push({ status: "credentials", credential: credentialFixture() });
    const done = await service.poll(begun.id);
    expect(done.state).toBe("succeeded");
    expect(connector.calls).not.toContain("submit:code");
  });

  test("a step awaiting input without a poll request is never polled", async () => {
    const { service, connector } = setup();
    connector.beginQueue.push({
      status: "next_step",
      nextStep: {
        kind: "api_key",
        keyPageUrl: "https://example.com/keys",
        fields: [{ name: "key", label: "API key", secret: true }],
      },
      privateState: null,
    });
    const begun = await service.begin({ provider: "codex", method: "api_key" });
    expect(begun.pollAfterMs).toBe(0);
    const same = await service.poll(begun.id);
    expect(same.state).toBe("awaiting_input");
    expect(connector.calls).not.toContain("poll");
  });

  test("connecting an identity that already exists reconnects it instead of duplicating", async () => {
    const { service, connector, connections, credentials } = setup();
    connector.beginQueue.push({ status: "credentials", credential: credentialFixture("first") });
    const first = await service.begin({ provider: "codex", method: "import" });
    connections.requireReconnect(first.connectionId!, "token_rejected");
    connector.beginQueue.push({ status: "credentials", credential: credentialFixture("second") });
    const second = await service.begin({ provider: "codex", method: "import" });
    expect(second.connectionId).toBe(first.connectionId);
    expect(connections.list()).toHaveLength(1);
    expect(connections.get(first.connectionId!)?.state).toBe("ready");
    expect(credentials.get(first.connectionId!)?.secret).toEqual(
      credentialFixture("second").secret,
    );
  });

  test("reconnect with a different identity fails with identity_mismatch and keeps old credentials", async () => {
    const { service, connector, connections, credentials } = setup();
    connector.beginQueue.push({ status: "credentials", credential: credentialFixture("first") });
    const first = await service.begin({ provider: "codex", method: "import" });
    connections.requireReconnect(first.connectionId!, "refresh_rejected");
    connector.identityResult = {
      providerAccountId: "someone-else",
      workspaceId: null,
      label: "X",
      assurance: "strong",
    };
    connector.beginQueue.push({ status: "credentials", credential: credentialFixture("second") });
    const attempt = await service.begin({
      provider: "codex",
      method: "import",
      connectionId: first.connectionId!,
    });
    expect(attempt.state).toBe("failed");
    expect(attempt.error).toContain("identity_mismatch");
    expect(connections.get(first.connectionId!)?.state).toBe("reconnect_required");
    expect(credentials.get(first.connectionId!)?.secret).toEqual(credentialFixture("first").secret);
  });

  test("a definitive failure during first collection removes the new connection", async () => {
    const { service, connector, connections } = setup();
    connector.beginQueue.push({ status: "credentials", credential: credentialFixture() });
    connector.collectQueue.push(new ConnectorError("authentication_required", "usage says 401"));
    const attempt = await service.begin({ provider: "codex", method: "import" });
    expect(attempt.state).toBe("failed");
    expect(connections.list()).toHaveLength(0);
  });

  test("a transient failure during first collection still yields a partial connection", async () => {
    const { service, connector, connections } = setup();
    connector.beginQueue.push({ status: "credentials", credential: credentialFixture() });
    connector.collectQueue.push(new ConnectorError("rate_limited", "429", 1000));
    const attempt = await service.begin({ provider: "codex", method: "import" });
    expect(attempt.state).toBe("succeeded");
    expect(connections.get(attempt.connectionId!)?.state).toBe("partial");
  });

  test("denied approval fails, expired approval expires, cancel cancels, disabled provider refuses", async () => {
    const { service, connector } = setup();
    connector.beginQueue.push({
      status: "error",
      error: { category: "approval_denied", class: "definitive", message: "denied" },
    });
    expect((await service.begin({ provider: "codex", method: "device_code" })).state).toBe(
      "failed",
    );
    connector.beginQueue.push({
      status: "error",
      error: { category: "approval_expired", class: "definitive", message: "expired" },
    });
    expect((await service.begin({ provider: "codex", method: "device_code" })).state).toBe(
      "expired",
    );
    const live = await service.begin({ provider: "codex", method: "device_code" });
    const cancelled = await service.cancel(live.id);
    expect(cancelled.state).toBe("cancelled");
    expect(connector.calls).toContain("cancel");
    expect(await rejection(service.submit(live.id, { kind: "code", value: "x" }))).toBeInstanceOf(
      InvalidAttemptStateError,
    );
    expect(
      await rejection(service.begin({ provider: "claude", method: "device_code" })),
    ).toBeInstanceOf(ProviderDisabledError);
  });

  test("a connector that throws during begin fails the attempt instead of crashing", async () => {
    const { service, connector } = setup();
    connector.beginConnect = () => Promise.reject(new Error("socket hang up"));
    const attempt = await service.begin({ provider: "codex", method: "device_code" });
    expect(attempt.state).toBe("failed");
    expect(attempt.error).toContain("internal_error");
  });
});
