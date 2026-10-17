import { describe, expect, test } from "bun:test";

import type { Identity } from "../connector.ts";
import { CredentialStore } from "../credentials.ts";
import { createKeyring, generateKeyHex, parseKeyHex } from "../crypto/index.ts";
import { openDatabase } from "../db/index.ts";
import { ConnectionStore } from "../lifecycle.ts";
import { credentialFixture, FakeConnector } from "./fake-connector.ts";
import { upgradeIdentities } from "./identity-upgrade.ts";

const legacy = (providerAccountId: string): Identity => ({
  providerAccountId,
  workspaceId: null,
  label: "Fake",
  assurance: "strong",
});

function setup(upgrade: (stored: Identity) => Identity | null) {
  const { db } = openDatabase({ path: ":memory:" });
  const keyring = createKeyring({ 1: parseKeyHex(generateKeyHex()) });
  const connections = new ConnectionStore(db, () => new Date(1_700_000_000_000));
  const credentials = new CredentialStore(db, keyring);
  const connector = Object.assign(new FakeConnector("codex"), {
    upgradeIdentity: (_credential: unknown, stored: Identity) => upgrade(stored),
  });
  const logs: string[] = [];
  const add = (identity: Identity) => {
    const row = connections.create({
      provider: "codex",
      identity,
      scope: "individual",
      authMethod: "cli_login",
      interface: "private",
      connectorVersion: "fake-1",
    });
    credentials.put(row.id, credentialFixture());
    return row;
  };
  const run = () =>
    upgradeIdentities({
      registry: { get: (p) => (p === "codex" ? connector : undefined), list: () => [connector] },
      connections,
      credentials,
      log: (level, message) => logs.push(`${level} ${message}`),
    });
  return { connections, add, run, logs };
}

describe("upgradeIdentities", () => {
  test("re-keys a stored identity in place and is idempotent", () => {
    const { connections, add, run } = setup((stored) =>
      stored.workspaceId === null
        ? { ...stored, providerAccountId: "user-a", workspaceId: stored.providerAccountId }
        : null,
    );
    const row = add(legacy("ws-1"));
    expect(run()).toBe(1);
    const after = connections.get(row.id)!;
    expect([after.providerAccountId, after.workspaceId]).toEqual(["user-a", "ws-1"]);
    expect(connections.list()).toHaveLength(1);
    expect(run()).toBe(0);
  });

  test("skips a connection whose new key another connection holds", () => {
    const { connections, add, run, logs } = setup((stored) =>
      stored.workspaceId === null
        ? { ...stored, providerAccountId: "user-a", workspaceId: "ws-1" }
        : null,
    );
    const row = add(legacy("ws-1"));
    add({ ...legacy("user-a"), workspaceId: "ws-1" });
    expect(run()).toBe(0);
    expect(connections.get(row.id)!.workspaceId).toBeNull();
    expect(logs.join("\n")).toMatch(/key in use/);
  });

  test("an unreadable credential skips that connection without failing startup", () => {
    const { add, run, logs } = setup(() => {
      throw new Error("bad token");
    });
    add(legacy("ws-1"));
    expect(run()).toBe(0);
    expect(logs.join("\n")).toMatch(/skipped/);
  });
});
