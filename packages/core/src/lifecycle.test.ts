import { describe, expect, test } from "bun:test";

import { classified, type Identity } from "./connector.ts";
import { createKeyring, generateKeyHex, parseKeyHex } from "./crypto/index.ts";
import { openDatabase, schema } from "./db/index.ts";
import {
  AttemptStore,
  ConnectionStore,
  IdentityMismatchError,
  InvalidTransitionError,
} from "./lifecycle.ts";

function setup() {
  const { db } = openDatabase({ path: ":memory:" });
  let now = 1_700_000_000_000;
  const clock = () => new Date(now);
  const keyring = createKeyring({ 1: parseKeyHex(generateKeyHex()) });
  return {
    db,
    attempts: new AttemptStore(db, keyring, clock),
    connections: new ConnectionStore(db, clock),
    advance: (ms: number) => (now += ms),
  };
}

const identity: Identity = {
  providerAccountId: "acct-1",
  workspaceId: null,
  label: "Codex",
  assurance: "strong",
};

describe("AttemptStore", () => {
  test("device code step puts the attempt in awaiting_user with encrypted private state", () => {
    const { db, attempts } = setup();
    const a = attempts.create({ provider: "codex", method: "cli_login", ttlMs: 60_000 });
    expect(a.state).toBe("created");
    const stepped = attempts.setNextStep(
      a.id,
      {
        kind: "device_code",
        verificationUrl: "https://example.com/device",
        userCode: "ABCD-1234",
        expiresAt: 1,
      },
      { pollSecret: "s3cret" },
    );
    expect(stepped.state).toBe("awaiting_user");
    expect(stepped.nextStep).toBe("device_code");
    const raw = db.select().from(schema.authAttempts).get();
    expect(Buffer.from(raw?.privateCiphertext ?? "").toString()).not.toContain("s3cret");
    expect(attempts.privateState(a.id)).toEqual({ pollSecret: "s3cret" });
  });

  test("paste steps put the attempt in awaiting_input", () => {
    const { attempts } = setup();
    const a = attempts.create({ provider: "claude", method: "cli_login", ttlMs: 60_000 });
    const stepped = attempts.setNextStep(
      a.id,
      {
        kind: "paste_redirect",
        url: "https://example.com/auth",
        expiresAt: 1,
        accepts: "url_or_code",
      },
      null,
    );
    expect(stepped.state).toBe("awaiting_input");
  });

  test("terminal transitions wipe step and private state; invalid transitions throw", () => {
    const { attempts } = setup();
    const a = attempts.create({ provider: "codex", method: "cli_login", ttlMs: 60_000 });
    attempts.setNextStep(
      a.id,
      { kind: "open_url", url: "https://example.com", expiresAt: 1 },
      { x: 1 },
    );
    attempts.transition(a.id, "validating");
    expect(() => attempts.transition(a.id, "cancelled")).toThrow(InvalidTransitionError);
    const done = attempts.transition(a.id, "succeeded");
    expect(done.state).toBe("succeeded");
    expect(done.nextStep).toBeNull();
    expect(done.privateCiphertext).toBeNull();
    expect(() => attempts.transition(a.id, "failed")).toThrow(InvalidTransitionError);
  });

  test("failed records a sanitized error", () => {
    const { attempts } = setup();
    const a = attempts.create({ provider: "codex", method: "cli_login", ttlMs: 60_000 });
    const failed = attempts.transition(
      a.id,
      "failed",
      classified("approval_denied", "the user denied access"),
    );
    expect(failed.sanitizedError).toBe("approval_denied: the user denied access");
  });

  test("expireOverdue expires only non-terminal attempts past their deadline", () => {
    const { attempts, advance } = setup();
    const a = attempts.create({ provider: "codex", method: "cli_login", ttlMs: 1_000 });
    const b = attempts.create({ provider: "codex", method: "cli_login", ttlMs: 10_000 });
    const c = attempts.create({ provider: "codex", method: "cli_login", ttlMs: 1_000 });
    attempts.transition(c.id, "cancelled");
    advance(2_000);
    expect(attempts.expireOverdue()).toEqual([a.id]);
    expect(attempts.get(a.id)?.state).toBe("expired");
    expect(attempts.get(b.id)?.state).toBe("created");
    expect(attempts.get(c.id)?.state).toBe("cancelled");
  });
});

describe("ConnectionStore", () => {
  const base = {
    provider: "codex" as const,
    identity,
    scope: "individual" as const,
    authMethod: "cli_login" as const,
    interface: "private" as const,
    connectorVersion: "0.1.0",
  };

  test("create, find by identity, list", () => {
    const { connections } = setup();
    const c = connections.create(base);
    expect(c.state).toBe("ready");
    expect(connections.findByIdentity("codex", identity, "individual")?.id).toBe(c.id);
    expect(
      connections.findByIdentity(
        "codex",
        { ...identity, providerAccountId: "other" },
        "individual",
      ),
    ).toBeNull();
    expect(connections.list()).toHaveLength(1);
  });

  test("only definitive failures change state", () => {
    const { connections } = setup();
    const c = connections.create(base);
    expect(connections.applyFailure(c.id, classified("rate_limited", "429", 1000))).toBe(
      "unchanged",
    );
    expect(connections.applyFailure(c.id, classified("permission_denied", "403"))).toBe(
      "unchanged",
    );
    expect(connections.get(c.id)?.state).toBe("ready");
    expect(
      connections.applyFailure(c.id, classified("authentication_required", "401 after refresh")),
    ).toBe("state_changed");
    expect(connections.get(c.id)?.state).toBe("reconnect_required");
    expect(connections.get(c.id)?.reconnectReason).toBe("token_rejected");
  });

  test("reconnect requires the same identity and clears the reason", () => {
    const { connections } = setup();
    const c = connections.create(base);
    connections.requireReconnect(c.id, "refresh_rejected");
    expect(() =>
      connections.reconnected(
        c.id,
        { ...identity, providerAccountId: "someone-else" },
        "import",
        "0.1.0",
      ),
    ).toThrow(IdentityMismatchError);
    const back = connections.reconnected(c.id, identity, "import", "0.1.1");
    expect(back.state).toBe("ready");
    expect(back.reconnectReason).toBeNull();
    expect(back.authMethod).toBe("import");
    expect(back.connectorVersion).toBe("0.1.1");
  });

  test("markSuccess records last_success_at; pause does not override reconnect_required", () => {
    const { connections } = setup();
    const c = connections.create(base);
    connections.markSuccess(c.id, new Date(1_700_000_005_000), "partial");
    expect(connections.get(c.id)?.state).toBe("partial");
    expect(connections.get(c.id)?.lastSuccessAt?.getTime()).toBe(1_700_000_005_000);
    connections.setPaused(c.id, true);
    expect(connections.get(c.id)?.state).toBe("paused");
    connections.setPaused(c.id, false);
    connections.requireReconnect(c.id, "token_rejected");
    connections.setPaused(c.id, true);
    expect(connections.get(c.id)?.state).toBe("reconnect_required");
  });
});
