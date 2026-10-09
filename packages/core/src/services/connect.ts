import { z } from "zod";

import type {
  ClassifiedError,
  ConnectProgress,
  Connector,
  Identity,
  NextStepPayload,
  SubmitInput,
} from "../connector.ts";
import type { MethodAvailability, RefreshResult } from "../connector.ts";
import { classifyUnknown, nextStepPayloadSchema } from "../connector.ts";
import type { CredentialStore, StoredCredential } from "../credentials.ts";
import {
  type AttemptState,
  type AuthMethod,
  type ConnectionScope,
  type Provider,
  terminalAttemptStates,
} from "../enums.ts";
import {
  type AttemptRow,
  type AttemptStore,
  type ConnectionStore,
  IdentityMismatchError,
} from "../lifecycle.ts";
import type { SnapshotStore } from "../snapshots.ts";

/**
 * Drives a connector through an attempt: begin, submit input, poll, cancel, and the
 * validation that turns credentials into a ready or partial connection.
 * Mirrors the browser flow in docs/architecture/connections.md.
 */

export interface ConnectorRegistry {
  get(provider: Provider): Connector | undefined;
  list(): readonly Connector[];
}

/** Everything the browser may see about an attempt. Never a secret. */
export interface AttemptView {
  readonly id: string;
  readonly provider: Provider;
  readonly method: AuthMethod;
  readonly state: AttemptState;
  readonly nextStep: NextStepPayload | null;
  readonly error: string | null;
  readonly connectionId: string | null;
  readonly expiresAt: number;
  /** How long the browser should wait before polling again. */
  readonly pollAfterMs: number;
}

const privateEnvelopeSchema = z.object({
  connector: z.unknown(),
  nextPollAt: z.number().nullable(),
});
type PrivateEnvelope = z.infer<typeof privateEnvelopeSchema>;

export interface ConnectServiceOptions {
  readonly registry: ConnectorRegistry;
  readonly attempts: AttemptStore;
  readonly connections: ConnectionStore;
  readonly credentials: CredentialStore;
  readonly snapshots: SnapshotStore;
  readonly attemptTtlMs?: number;
  /** Refresh an imported credential this long before it expires, before its first collection. */
  readonly refreshLeadMs?: number;
  readonly now?: () => Date;
}

/** Refresh this long before a credential expires. Shared by collection and first validation. */
export const defaultRefreshLeadMs = 5 * 60 * 1000;

export class ConnectService {
  private readonly attemptTtlMs: number;
  private readonly refreshLeadMs: number;
  private readonly now: () => Date;

  constructor(private readonly deps: ConnectServiceOptions) {
    this.attemptTtlMs = deps.attemptTtlMs ?? 15 * 60 * 1000;
    this.refreshLeadMs = deps.refreshLeadMs ?? defaultRefreshLeadMs;
    this.now = deps.now ?? (() => new Date());
  }

  /** Connect a new account, or Reconnect an existing connection when `connectionId` is given. */
  async begin(input: {
    provider: Provider;
    method: AuthMethod;
    scope?: ConnectionScope;
    connectionId?: string;
  }): Promise<AttemptView> {
    const connector = this.requireConnector(input.provider);
    if (!connector.supportedMethods.includes(input.method)) {
      throw new UnsupportedMethodError(input.provider, input.method);
    }
    // Fail before the attempt exists: a missing CLI is not a sign-in failure.
    const availability = connector.methodAvailability?.(input.method);
    if (availability && !availability.available) throw new MethodUnavailableError(availability);
    let existingIdentity: Identity | undefined;
    if (input.connectionId) {
      const connection = this.deps.connections.get(input.connectionId);
      if (!connection || connection.provider !== input.provider)
        throw new Error("connection not found");
      existingIdentity = {
        providerAccountId: connection.providerAccountId,
        workspaceId: connection.workspaceId,
        label: connection.label,
        assurance: "strong",
      };
    }
    const attempt = this.deps.attempts.create({
      provider: input.provider,
      method: input.method,
      ttlMs: this.attemptTtlMs,
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    });
    const progress = await this.safely(connector, () =>
      connector.beginConnect({
        attemptId: attempt.id,
        method: input.method,
        expiresAt: attempt.expiresAt.getTime(),
        ...(existingIdentity ? { existingIdentity } : {}),
      }),
    );
    await this.apply(attempt.id, connector, progress, input.scope ?? "individual");
    return this.view(attempt.id);
  }

  async submit(
    attemptId: string,
    input: SubmitInput,
    scope: ConnectionScope = "individual",
  ): Promise<AttemptView> {
    const attempt = this.requireLive(attemptId);
    if (attempt.state !== "awaiting_input") throw new InvalidAttemptStateError(attempt.state);
    const connector = this.requireConnector(attempt.provider);
    const envelope = this.envelope(attemptId);
    const progress = await this.safely(connector, () =>
      connector.submitInput(envelope.connector, input),
    );
    await this.apply(attemptId, connector, progress, scope);
    return this.view(attemptId);
  }

  /** Called on every browser poll; asks the connector only when its poll interval has elapsed. */
  async poll(attemptId: string, scope: ConnectionScope = "individual"): Promise<AttemptView> {
    const attempt = this.deps.attempts.get(attemptId);
    if (!attempt) throw new Error("attempt not found");
    if (!this.polls(attempt)) return this.view(attemptId);
    if (attempt.expiresAt.getTime() <= this.now().getTime()) {
      // The attempt is expired even if the connector's cleanup throws; the sweep at startup is the backstop.
      await this.expire(attemptId).catch(() => undefined);
      return this.view(attemptId);
    }
    const envelope = this.envelope(attemptId);
    if (envelope.nextPollAt !== null && envelope.nextPollAt > this.now().getTime())
      return this.view(attemptId);
    const connector = this.requireConnector(attempt.provider);
    const progress = await this.safely(connector, () => connector.pollConnect(envelope.connector));
    await this.apply(attemptId, connector, progress, scope);
    return this.view(attemptId);
  }

  async cancel(attemptId: string): Promise<AttemptView> {
    const attempt = this.requireLive(attemptId);
    const connector = this.requireConnector(attempt.provider);
    const envelope = this.envelope(attemptId);
    try {
      await connector.cancelConnect(envelope.connector);
    } finally {
      this.deps.attempts.transition(attemptId, "cancelled");
    }
    return this.view(attemptId);
  }

  /**
   * Expire an attempt past its deadline. The connector cleans up first, with the private state
   * read before the terminal transition wipes it: a CLI sign-in leaves a plaintext credentials
   * file in its attempt directory until the connector removes it.
   */
  async expire(attemptId: string): Promise<void> {
    const attempt = this.deps.attempts.get(attemptId);
    if (!attempt || (terminalAttemptStates as readonly AttemptState[]).includes(attempt.state))
      return;
    try {
      const connector = this.deps.registry.get(attempt.provider);
      if (connector) await connector.cancelConnect(this.envelope(attemptId).connector);
    } finally {
      // A poll may have expired it while the cleanup ran.
      const current = this.deps.attempts.get(attemptId);
      if (current && !(terminalAttemptStates as readonly AttemptState[]).includes(current.state))
        this.deps.attempts.transition(attemptId, "expired");
    }
  }

  view(attemptId: string): AttemptView {
    const attempt = this.deps.attempts.get(attemptId);
    if (!attempt) throw new Error("attempt not found");
    const live = this.polls(attempt);
    return {
      id: attempt.id,
      provider: attempt.provider,
      method: attempt.method,
      state: attempt.state,
      nextStep: parseNextStep(attempt.nextStepPayload),
      error: attempt.sanitizedError,
      connectionId: attempt.connectionId,
      expiresAt: attempt.expiresAt.getTime(),
      pollAfterMs: live ? 2000 : 0,
    };
  }

  /**
   * Whether the connector is asked for progress: always while the provider site is awaited,
   * and while input is awaited only when the connector's step asked to be polled meanwhile.
   */
  private polls(attempt: AttemptRow): boolean {
    if (attempt.state === "awaiting_user") return true;
    if (attempt.state !== "awaiting_input") return false;
    return this.envelope(attempt.id).nextPollAt !== null;
  }

  private async apply(
    attemptId: string,
    connector: Connector,
    progress: ConnectProgress,
    scope: ConnectionScope,
  ): Promise<void> {
    switch (progress.status) {
      case "next_step":
        this.deps.attempts.setNextStep(attemptId, progress.nextStep, {
          connector: progress.privateState,
          nextPollAt:
            progress.pollAfterMs === undefined ? null : this.now().getTime() + progress.pollAfterMs,
        } satisfies PrivateEnvelope);
        return;
      case "waiting":
        this.deps.attempts.setPrivateState(attemptId, {
          connector: progress.privateState,
          nextPollAt: this.now().getTime() + progress.pollAfterMs,
        } satisfies PrivateEnvelope);
        return;
      case "credentials":
        await this.validate(attemptId, connector, progress.credential, scope);
        return;
      case "error":
        this.fail(attemptId, progress.error);
        return;
    }
  }

  /** Identity, capabilities and one read-only collection; then the connection exists or the attempt fails. */
  private async validate(
    attemptId: string,
    connector: Connector,
    credential: StoredCredential,
    scope: ConnectionScope,
  ): Promise<void> {
    const attempt = this.deps.attempts.transition(attemptId, "validating");
    let identity: Identity;
    try {
      identity = await connector.identity(credential);
    } catch (error) {
      this.fail(attemptId, connector.classify(error));
      return;
    }

    let connectionId: string;
    // Only a connection this attempt created is deleted when its first collection fails.
    let created = false;
    try {
      if (attempt.connectionId) {
        connectionId = this.deps.connections.reconnected(
          attempt.connectionId,
          identity,
          attempt.method,
          connector.version,
        ).id;
      } else {
        const existing = this.deps.connections.findByIdentity(attempt.provider, identity, scope);
        connectionId = existing
          ? this.deps.connections.reconnected(
              existing.id,
              identity,
              attempt.method,
              connector.version,
            ).id
          : this.deps.connections.create({
              provider: attempt.provider,
              identity,
              scope,
              authMethod: attempt.method,
              interface: connector.interface,
              connectorVersion: connector.version,
            }).id;
        created = existing === null;
      }
    } catch (error) {
      if (error instanceof IdentityMismatchError) {
        this.fail(attemptId, {
          category: "identity_mismatch",
          class: "definitive",
          message: error.message,
        });
        return;
      }
      throw error;
    }

    this.deps.credentials.put(connectionId, credential);

    const run = this.deps.snapshots.startRun(connectionId);
    try {
      // An imported file may hold an expired access token with a live refresh token.
      let usable = credential;
      if (
        credential.expiresAt !== null &&
        credential.expiresAt - this.refreshLeadMs <= this.now().getTime()
      ) {
        const refreshed = await refreshAndStore(
          this.deps.credentials,
          connectionId,
          connector,
          credential,
        );
        if (refreshed.status === "refreshed") usable = refreshed.credential;
      }
      const capabilities = await connector.capabilities(usable, identity);
      this.deps.snapshots.setCapabilities(connectionId, capabilities);
      const result = await connector.collect(usable, identity);
      this.deps.snapshots.record(connectionId, run.id, result, connector.version);
      const partial =
        result.failures.length > 0 || result.metrics.some((m) => m.availability !== "available");
      this.deps.connections.markSuccess(
        connectionId,
        new Date(result.observedAt),
        partial ? "partial" : "ready",
      );
      this.deps.snapshots.finishRun(run.id, partial ? "partial" : "succeeded");
    } catch (error) {
      const classifiedError = connector.classify(error);
      this.deps.snapshots.finishRun(run.id, outcomeFor(classifiedError), classifiedError);
      if (classifiedError.class === "definitive") {
        this.deps.credentials.delete(connectionId);
        if (created) this.deps.connections.delete(connectionId);
        else this.deps.connections.requireReconnect(connectionId, "token_rejected");
        this.fail(attemptId, classifiedError);
        return;
      }
      // Identity worked and credentials are stored; the first collection failing is a partial connection.
      this.deps.connections.markSuccess(connectionId, this.now(), "partial");
    }
    this.deps.attempts.transition(attemptId, "succeeded");
    this.bind(attemptId, connectionId);
  }

  private bind(attemptId: string, connectionId: string): void {
    // The attempt row keeps its connection id so the browser can navigate to the result.
    this.deps.attempts.bindConnection(attemptId, connectionId);
  }

  private fail(attemptId: string, error: ClassifiedError): void {
    const attempt = this.deps.attempts.get(attemptId);
    if (!attempt) return;
    const to: AttemptState = error.category === "approval_expired" ? "expired" : "failed";
    this.deps.attempts.transition(attemptId, to, error);
  }

  private envelope(attemptId: string): PrivateEnvelope {
    const parsed = privateEnvelopeSchema.safeParse(this.deps.attempts.privateState(attemptId));
    return parsed.success ? parsed.data : { connector: null, nextPollAt: null };
  }

  private requireLive(attemptId: string): AttemptRow {
    const attempt = this.deps.attempts.get(attemptId);
    if (!attempt) throw new Error("attempt not found");
    if (["succeeded", "failed", "expired", "cancelled"].includes(attempt.state)) {
      throw new InvalidAttemptStateError(attempt.state);
    }
    return attempt;
  }

  private requireConnector(provider: Provider): Connector {
    const connector = this.deps.registry.get(provider);
    if (!connector) throw new ProviderDisabledError(provider);
    return connector;
  }

  /** Connector exceptions become classified errors instead of crashing the attempt. */
  private async safely(
    connector: Connector,
    fn: () => Promise<ConnectProgress>,
  ): Promise<ConnectProgress> {
    try {
      return await fn();
    } catch (error) {
      return { status: "error", error: safeClassify(connector, error) };
    }
  }
}

function parseNextStep(raw: unknown): NextStepPayload | null {
  const parsed = nextStepPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${String(value)}`);
}

function safeClassify(connector: Connector, error: unknown): ClassifiedError {
  try {
    return connector.classify(error);
  } catch {
    return classifyUnknown(error);
  }
}

/**
 * One refresh call and its persistence. A rotated credential is stored before anyone uses it,
 * and the stored refresh state follows the result. A throw counts as a transient failure.
 */
export async function refreshAndStore(
  credentials: CredentialStore,
  connectionId: string,
  connector: Connector,
  credential: StoredCredential,
): Promise<RefreshResult> {
  let result: RefreshResult;
  try {
    result = await connector.refresh(credential);
  } catch (error) {
    result = { status: "transient", error: safeClassify(connector, error) };
  }
  switch (result.status) {
    case "refreshed":
      credentials.put(connectionId, result.credential, "fresh");
      break;
    case "not_refreshable":
      credentials.setRefreshState(connectionId, "not_refreshable");
      break;
    case "transient":
      credentials.setRefreshState(connectionId, "refresh_due");
      break;
    case "rejected":
      credentials.setRefreshState(connectionId, "refresh_failed");
      break;
    default:
      return assertNever(result);
  }
  return result;
}

export function outcomeFor(
  error: ClassifiedError,
): "rate_limited" | "provider_unavailable" | "authentication_failed" | "invalid_response" {
  switch (error.category) {
    case "rate_limited":
      return "rate_limited";
    case "authentication_required":
    case "identity_mismatch":
    case "approval_denied":
    case "approval_expired":
      return "authentication_failed";
    case "invalid_response":
    case "unsupported_metric":
    case "permission_denied":
    case "selection_required":
      return "invalid_response";
    case "provider_unavailable":
    case "internal_error":
      return "provider_unavailable";
    default:
      return assertNever(error.category);
  }
}

export class ProviderDisabledError extends Error {
  constructor(readonly provider: Provider) {
    super(`provider ${provider} is not enabled`);
    this.name = "ProviderDisabledError";
  }
}

export class UnsupportedMethodError extends Error {
  constructor(
    readonly provider: Provider,
    readonly method: string,
  ) {
    super(`provider ${provider} does not support method ${method}`);
    this.name = "UnsupportedMethodError";
  }
}

export class MethodUnavailableError extends Error {
  constructor(readonly availability: MethodAvailability) {
    super(
      availability.cli === null
        ? `method ${availability.method} is not available on this server`
        : `the ${availability.cli} CLI is not installed on the server`,
    );
    this.name = "MethodUnavailableError";
  }
}

export class InvalidAttemptStateError extends Error {
  constructor(readonly state: AttemptState) {
    super(`attempt is ${state}`);
    this.name = "InvalidAttemptStateError";
  }
}
