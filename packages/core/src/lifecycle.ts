import { and, eq, inArray, isNull, lt } from "drizzle-orm";

import type { ClassifiedError, Identity, NextStepPayload } from "./connector.ts";
import { type Keyring, openJson, sealJson } from "./crypto/index.ts";
import { type Db, schema } from "./db/index.ts";
import {
  type AttemptState,
  type AuthMethod,
  type ConnectionScope,
  type ConnectionState,
  type InterfaceLabel,
  type NextStep,
  type Provider,
  type ReconnectReason,
  terminalAttemptStates,
} from "./enums.ts";

/**
 * Attempt and connection state machines from docs/architecture/connections.md.
 * Every transition goes through here so the rules live in one place.
 */

const attemptTransitions: Readonly<Record<AttemptState, readonly AttemptState[]>> = {
  created: ["awaiting_user", "awaiting_input", "validating", "failed", "expired", "cancelled"],
  awaiting_user: [
    "awaiting_user",
    "awaiting_input",
    "validating",
    "failed",
    "expired",
    "cancelled",
  ],
  awaiting_input: [
    "awaiting_user",
    "awaiting_input",
    "validating",
    "failed",
    "expired",
    "cancelled",
  ],
  validating: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  expired: [],
  cancelled: [],
};

/** Which attempt state a next step puts the attempt in. */
const stateForStep: Readonly<Record<NextStep, AttemptState>> = {
  open_url: "awaiting_user",
  device_code: "awaiting_user",
  paste_redirect: "awaiting_input",
  select_account: "awaiting_input",
  api_key: "awaiting_input",
  paste_file: "awaiting_input",
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: AttemptState,
    readonly to: AttemptState,
  ) {
    super(`attempt cannot move from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export type AttemptRow = typeof schema.authAttempts.$inferSelect;

export class AttemptStore {
  constructor(
    private readonly db: Db,
    private readonly keyring: Keyring,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: {
    provider: Provider;
    method: AuthMethod;
    connectionId?: string;
    ttlMs: number;
  }): AttemptRow {
    const id = Bun.randomUUIDv7();
    const now = this.now();
    this.db
      .insert(schema.authAttempts)
      .values({
        id,
        provider: input.provider,
        method: input.method,
        state: "created",
        connectionId: input.connectionId ?? null,
        expiresAt: new Date(now.getTime() + input.ttlMs),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.get(id)!;
  }

  get(id: string): AttemptRow | null {
    return (
      this.db.select().from(schema.authAttempts).where(eq(schema.authAttempts.id, id)).get() ?? null
    );
  }

  /** Record a next step for the browser and the connector's private state, encrypted. */
  setNextStep(id: string, payload: NextStepPayload, privateState: unknown): AttemptRow {
    const row = this.require(id);
    const to = stateForStep[payload.kind];
    this.assertTransition(row.state, to);
    const sealed = sealJson(this.keyring, privateState ?? null, `attempt:${id}`);
    this.db
      .update(schema.authAttempts)
      .set({
        state: to,
        nextStep: payload.kind,
        nextStepPayload: payload,
        privateCiphertext: Buffer.from(sealed.ciphertext),
        privateNonce: Buffer.from(sealed.nonce),
        keyVersion: sealed.keyVersion,
        updatedAt: this.now(),
      })
      .where(eq(schema.authAttempts.id, id))
      .run();
    return this.get(id)!;
  }

  /** Keep the step, replace the private state (for example a refreshed poll cursor). */
  setPrivateState(id: string, privateState: unknown): void {
    const sealed = sealJson(this.keyring, privateState ?? null, `attempt:${id}`);
    this.db
      .update(schema.authAttempts)
      .set({
        privateCiphertext: Buffer.from(sealed.ciphertext),
        privateNonce: Buffer.from(sealed.nonce),
        keyVersion: sealed.keyVersion,
        updatedAt: this.now(),
      })
      .where(eq(schema.authAttempts.id, id))
      .run();
  }

  privateState(id: string): unknown {
    const row = this.require(id);
    if (!row.privateCiphertext || !row.privateNonce || row.keyVersion === null) return null;
    return openJson(
      this.keyring,
      { ciphertext: row.privateCiphertext, nonce: row.privateNonce, keyVersion: row.keyVersion },
      `attempt:${id}`,
    );
  }

  /** Move to `validating`, `succeeded`, `failed`, `expired` or `cancelled`. Terminal states wipe private state. */
  transition(id: string, to: AttemptState, error?: ClassifiedError): AttemptRow {
    const row = this.require(id);
    this.assertTransition(row.state, to);
    const terminal = (terminalAttemptStates as readonly AttemptState[]).includes(to);
    this.db
      .update(schema.authAttempts)
      .set({
        state: to,
        sanitizedError: error ? `${error.category}: ${error.message}` : row.sanitizedError,
        updatedAt: this.now(),
        ...(terminal
          ? {
              nextStep: null,
              nextStepPayload: null,
              privateCiphertext: null,
              privateNonce: null,
              keyVersion: null,
            }
          : {}),
      })
      .where(eq(schema.authAttempts.id, id))
      .run();
    return this.get(id)!;
  }

  /** Attach the resulting connection so the browser can navigate to it. */
  bindConnection(id: string, connectionId: string): void {
    this.db
      .update(schema.authAttempts)
      .set({ connectionId, updatedAt: this.now() })
      .where(eq(schema.authAttempts.id, id))
      .run();
  }

  /** Expire every non-terminal attempt past its deadline. Returns the ids expired. */
  expireOverdue(): string[] {
    const now = this.now();
    const overdue = this.db
      .select({ id: schema.authAttempts.id })
      .from(schema.authAttempts)
      .where(
        and(
          lt(schema.authAttempts.expiresAt, now),
          inArray(schema.authAttempts.state, ["created", "awaiting_user", "awaiting_input"]),
        ),
      )
      .all();
    for (const { id } of overdue) this.transition(id, "expired");
    return overdue.map((r) => r.id);
  }

  private require(id: string): AttemptRow {
    const row = this.get(id);
    if (!row) throw new Error(`attempt ${id} not found`);
    return row;
  }

  private assertTransition(from: AttemptState, to: AttemptState): void {
    if (!attemptTransitions[from].includes(to)) throw new InvalidTransitionError(from, to);
  }
}

export type ConnectionRow = typeof schema.connections.$inferSelect;

export class IdentityMismatchError extends Error {
  constructor() {
    super("new credentials resolve to a different account than the connection");
    this.name = "IdentityMismatchError";
  }
}

export class ConnectionStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: {
    provider: Provider;
    identity: Identity;
    scope: ConnectionScope;
    authMethod: AuthMethod;
    interface: InterfaceLabel;
    connectorVersion: string;
  }): ConnectionRow {
    const id = Bun.randomUUIDv7();
    const now = this.now();
    this.db
      .insert(schema.connections)
      .values({
        id,
        provider: input.provider,
        providerAccountId: input.identity.providerAccountId,
        workspaceId: input.identity.workspaceId,
        scope: input.scope,
        label: input.identity.label,
        authMethod: input.authMethod,
        state: "ready",
        interface: input.interface,
        connectorVersion: input.connectorVersion,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.get(id)!;
  }

  get(id: string): ConnectionRow | null {
    return (
      this.db.select().from(schema.connections).where(eq(schema.connections.id, id)).get() ?? null
    );
  }

  list(): ConnectionRow[] {
    return this.db.select().from(schema.connections).orderBy(schema.connections.createdAt).all();
  }

  findByIdentity(
    provider: Provider,
    identity: Identity,
    scope: ConnectionScope,
  ): ConnectionRow | null {
    return (
      this.db
        .select()
        .from(schema.connections)
        .where(
          and(
            eq(schema.connections.provider, provider),
            eq(schema.connections.providerAccountId, identity.providerAccountId),
            identity.workspaceId === null
              ? isNull(schema.connections.workspaceId)
              : eq(schema.connections.workspaceId, identity.workspaceId),
            eq(schema.connections.scope, scope),
          ),
        )
        .get() ?? null
    );
  }

  /** Reconnect: the identity must match; on success the connection is `ready` again with no reason. */
  reconnected(
    id: string,
    identity: Identity,
    authMethod: AuthMethod,
    connectorVersion: string,
  ): ConnectionRow {
    const row = this.require(id);
    if (
      row.providerAccountId !== identity.providerAccountId ||
      row.workspaceId !== identity.workspaceId
    ) {
      throw new IdentityMismatchError();
    }
    this.db
      .update(schema.connections)
      .set({
        state: "ready",
        reconnectReason: null,
        authMethod,
        connectorVersion,
        label: identity.label,
        updatedAt: this.now(),
      })
      .where(eq(schema.connections.id, id))
      .run();
    return this.get(id)!;
  }

  markSuccess(
    id: string,
    observedAt: Date,
    state: Extract<ConnectionState, "ready" | "partial">,
  ): void {
    this.db
      .update(schema.connections)
      .set({ state, reconnectReason: null, lastSuccessAt: observedAt, updatedAt: this.now() })
      .where(eq(schema.connections.id, id))
      .run();
  }

  requireReconnect(id: string, reason: ReconnectReason): void {
    this.db
      .update(schema.connections)
      .set({ state: "reconnect_required", reconnectReason: reason, updatedAt: this.now() })
      .where(eq(schema.connections.id, id))
      .run();
  }

  setPaused(id: string, paused: boolean): void {
    const row = this.require(id);
    if (paused && row.state === "reconnect_required") return;
    this.db
      .update(schema.connections)
      .set({ state: paused ? "paused" : "ready", updatedAt: this.now() })
      .where(eq(schema.connections.id, id))
      .run();
  }

  /** Owner-set display name; null clears it. Only this method writes the column. */
  setDisplayName(id: string, name: string | null): void {
    this.require(id);
    this.db
      .update(schema.connections)
      .set({ displayName: name, updatedAt: this.now() })
      .where(eq(schema.connections.id, id))
      .run();
  }

  delete(id: string): void {
    this.db.delete(schema.connections).where(eq(schema.connections.id, id)).run();
  }

  /**
   * Apply a classified failure from refresh or collection. Only a definitive class
   * changes the connection state; the caller records capability and run outcomes.
   */
  applyFailure(id: string, error: ClassifiedError): "state_changed" | "unchanged" {
    if (error.class !== "definitive") return "unchanged";
    const reason: ReconnectReason =
      error.category === "identity_mismatch" ? "identity_changed" : "token_rejected";
    this.requireReconnect(id, reason);
    return "state_changed";
  }

  private require(id: string): ConnectionRow {
    const row = this.get(id);
    if (!row) throw new Error(`connection ${id} not found`);
    return row;
  }
}
