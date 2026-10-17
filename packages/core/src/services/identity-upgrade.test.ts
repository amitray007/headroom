import { describe, expect, test } from "bun:test";

import type { Identity } from "../connector.ts";
import { CredentialStore, type StoredCredential } from "../credentials.ts";
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

/**
 * Mirrors the Codex rule: a workspace-only key moves to member plus workspace, and the member
 * comes from the credential itself, so a test fails if a row is upgraded from another credential.
 */
function memberUpgrade(credential: StoredCredential, stored: Identity): Identity | null {
  if (stored.workspaceId !== null) return null;
  const member = String(credential.secret["access"]);
  return { ...stored, providerAccountId: member, workspaceId: stored.providerAccountId };
}

function setup(upgrade = memberUpgrade) {
  const { db } = openDatabase({ path: ":memory:" });
  const keyring = createKeyring({ 1: parseKeyHex(generateKeyHex()) });
  const connections = new ConnectionStore(db, () => new Date(1_700_000_000_000));
  const credentials = new CredentialStore(db, keyring);
  const connector = Object.assign(new FakeConnector("codex"), { upgradeIdentity: upgrade });
  const other = new FakeConnector("claude");
  const logs: string[] = [];
  const add = (
    identity: Identity,
    member: string | null,
    provider: "codex" | "claude" = "codex",
  ) => {
    const row = connections.create({
      provider,
      identity,
      scope: "individual",
      authMethod: "cli_login",
      interface: "private",
      connectorVersion: "fake-1",
    });
    if (member) credentials.put(row.id, credentialFixture(member));
    return row;
  };
  const key = (id: string) => {
    const row = connections.get(id)!;
    return [row.providerAccountId, row.workspaceId];
  };
  const run = () =>
    upgradeIdentities({
      registry: {
        get: (p) => (p === "codex" ? connector : p === "claude" ? other : undefined),
        list: () => [connector, other],
      },
      connections,
      credentials,
      log: (level, message) => logs.push(`${level} ${message}`),
    });
  return { connections, add, key, run, logs };
}

describe("upgradeIdentities", () => {
  test("re-keys each connection from its own credential, in place, and only once", () => {
    const { connections, add, key, run, logs } = setup();
    const a = add(legacy("ws-1"), "user-a");
    const b = add(legacy("ws-2"), "user-b");
    expect(run()).toBe(2);
    expect(key(a.id)).toEqual(["user-a", "ws-1"]);
    expect(key(b.id)).toEqual(["user-b", "ws-2"]);
    expect(connections.list().map((row) => row.id)).toEqual([a.id, b.id]);
    expect(logs).toEqual(["info upgraded the identity key of 2 connection(s)"]);
    expect(run()).toBe(0);
    expect(key(a.id)).toEqual(["user-a", "ws-1"]);
  });

  test("skips a connection whose new key another connection holds", () => {
    const { add, key, run, logs } = setup();
    const row = add(legacy("ws-1"), "user-a");
    add({ ...legacy("user-a"), workspaceId: "ws-1" }, "user-a");
    expect(run()).toBe(0);
    expect(key(row.id)).toEqual(["ws-1", null]);
    expect(logs.join("\n")).toMatch(/key in use/);
  });

  test("leaves a connection without a credential and a connector without the hook alone", () => {
    const { add, key, run } = setup();
    const bare = add(legacy("ws-1"), null);
    const claude = add(legacy("org-1"), "user-c", "claude");
    expect(run()).toBe(0);
    expect(key(bare.id)).toEqual(["ws-1", null]);
    expect(key(claude.id)).toEqual(["org-1", null]);
  });

  test("a failing connection is logged and skipped while the others still upgrade", () => {
    const { add, key, run, logs } = setup((credential, stored) => {
      if (credential.secret["access"] === "broken") throw new Error("bad");
      return memberUpgrade(credential, stored);
    });
    const broken = add(legacy("ws-1"), "broken");
    const fine = add(legacy("ws-2"), "user-b");
    expect(run()).toBe(1);
    expect(key(broken.id)).toEqual(["ws-1", null]);
    expect(key(fine.id)).toEqual(["user-b", "ws-2"]);
    expect(logs.join("\n")).toMatch(`identity upgrade skipped for connection ${broken.id}`);
  });

  test("a database error while re-keying does not stop startup", () => {
    const { connections, add, key, run, logs } = setup();
    const row = add(legacy("ws-1"), "user-a");
    connections.rekey = () => {
      throw new Error("SQLITE_BUSY");
    };
    expect(run()).toBe(0);
    expect(key(row.id)).toEqual(["ws-1", null]);
    expect(logs.join("\n")).toMatch(/skipped/);
  });
});
