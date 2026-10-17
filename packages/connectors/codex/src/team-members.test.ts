import { describe, expect, test } from "bun:test";

import {
  AttemptStore,
  ConnectionStore,
  ConnectService,
  CredentialStore,
  crypto,
  openDatabase,
  SnapshotStore,
  upgradeIdentities,
} from "@headroom/core";

import { resetCreditsUrl, usageUrl } from "./endpoints.ts";
import resetCreditsFixture from "./fixtures/reset-credits.json";
import usageFixture from "./fixtures/usage.json";
import { createCodexConnector, credentialFromAuthFile } from "./index.ts";
import { accessToken, accountId, fakeFetch, FakeRunner, idToken, json } from "./test-support.ts";

/** The auth.json one member of the synthetic Team workspace gets from `codex login`. */
function memberAuthFile(member: string, email: string): string {
  return JSON.stringify({
    tokens: {
      id_token: idToken({
        email,
        "https://api.openai.com/auth": {
          chatgpt_account_id: accountId,
          chatgpt_plan_type: "team",
          chatgpt_user_id: member,
        },
      }),
      access_token: accessToken(),
      refresh_token: `refresh-${member}`,
      account_id: accountId,
    },
  });
}

const clock = () => new Date(1_700_000_000_000);

/** Real Codex connector, real stores and ConnectService; only HTTP is stubbed. */
function setup() {
  const { db } = openDatabase({ path: ":memory:" });
  const keyring = crypto.createKeyring({ 1: crypto.parseKeyHex(crypto.generateKeyHex()) });
  const connector = createCodexConnector({
    runner: new FakeRunner(),
    fetch: fakeFetch({
      [usageUrl]: () => json(usageFixture),
      [resetCreditsUrl]: () => json(resetCreditsFixture),
    }).fetch,
    now: () => clock().getTime(),
  });
  const registry = { get: () => connector, list: () => [connector] };
  const connections = new ConnectionStore(db, clock);
  const credentials = new CredentialStore(db, keyring);
  const service = new ConnectService({
    registry,
    attempts: new AttemptStore(db, keyring, clock),
    connections,
    credentials,
    snapshots: new SnapshotStore(db, clock),
    now: clock,
  });
  /** Paste an auth.json, as the Import method does; `connectionId` makes it a Reconnect. */
  const signIn = async (file: string, connectionId?: string) => {
    const begun = await service.begin({
      provider: "codex",
      method: "import",
      ...(connectionId ? { connectionId } : {}),
    });
    return service.submit(begun.id, { kind: "file", contents: file });
  };
  /** A connection as 0.1.8 stored it: the workspace id was the whole key. */
  const legacyRow = (file: string | null) => {
    const row = connections.create({
      provider: "codex",
      identity: {
        providerAccountId: accountId,
        workspaceId: null,
        label: "Old",
        assurance: "strong",
      },
      scope: "individual",
      authMethod: "import",
      interface: "private",
      connectorVersion: "0.1.0",
    });
    if (file) credentials.put(row.id, credentialFromAuthFile(file));
    return row;
  };
  const upgrade = () =>
    upgradeIdentities({ registry, connections, credentials, log: () => undefined });
  const refreshTokenOf = (id: string) => credentials.get(id)?.secret["refreshToken"];
  return { connections, signIn, legacyRow, upgrade, refreshTokenOf };
}

const alice = memberAuthFile("user-alice", "alice@example.com");
const bob = memberAuthFile("user-bob", "bob@example.com");

describe("Codex Team members of one workspace (issue #24)", () => {
  test("two members get two connections, and signing in again updates only that member", async () => {
    const { connections, signIn, refreshTokenOf } = setup();
    const a = await signIn(alice);
    const b = await signIn(bob);
    expect([a.state, b.state]).toEqual(["succeeded", "succeeded"]);
    expect(a.connectionId).not.toBe(b.connectionId);
    expect(connections.list().map((row) => row.label)).toEqual([
      "alice@example.com (team)",
      "bob@example.com (team)",
    ]);
    expect(refreshTokenOf(a.connectionId!)).toBe("refresh-user-alice");
    expect(refreshTokenOf(b.connectionId!)).toBe("refresh-user-bob");

    const again = await signIn(memberAuthFile("user-alice", "alice@example.com"));
    expect(again.connectionId).toBe(a.connectionId);
    expect(connections.list()).toHaveLength(2);
    expect(refreshTokenOf(b.connectionId!)).toBe("refresh-user-bob");
  });

  test("a 0.1.8 connection is re-keyed at startup, then the other member connects separately", async () => {
    const { connections, signIn, legacyRow, upgrade } = setup();
    const old = legacyRow(alice);
    expect(upgrade()).toBe(1);
    const row = connections.get(old.id)!;
    expect([row.providerAccountId, row.workspaceId]).toEqual(["user-alice", accountId]);

    const b = await signIn(bob);
    expect(b.connectionId).not.toBe(old.id);
    const a = await signIn(alice);
    expect(a.connectionId).toBe(old.id);
    expect(connections.list()).toHaveLength(2);
  });

  test("a 0.1.8 connection the startup upgrade skipped is restored by Reconnect", async () => {
    const { connections, signIn, legacyRow, upgrade, refreshTokenOf } = setup();
    const old = legacyRow(null);
    connections.requireReconnect(old.id, "token_rejected");
    expect(upgrade()).toBe(0);

    const attempt = await signIn(alice, old.id);
    expect(attempt.state).toBe("succeeded");
    expect(attempt.connectionId).toBe(old.id);
    const row = connections.get(old.id)!;
    expect([row.providerAccountId, row.workspaceId, row.state]).toEqual([
      "user-alice",
      accountId,
      "ready",
    ]);
    expect(refreshTokenOf(old.id)).toBe("refresh-user-alice");
  });
});
