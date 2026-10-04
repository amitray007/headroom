import { z } from "zod";

import type { StoredCredential } from "./credentials.ts";
import {
  type AccountActionKind,
  type Availability,
  type DisconnectResult,
  type ErrorCategory,
  type EvidenceLevel,
  type FailureClass,
  errorCategoryClass,
  type InterfaceLabel,
  type MetricKind,
  type Provider,
} from "./enums.ts";

/**
 * The contract every provider module implements. Mirrors docs/architecture/connector-contract.md.
 * Connectors keep no memory between calls; everything they need travels in `privateState`,
 * which the application stores encrypted on the attempt row.
 */

/** Browser-visible payload for the current step. Never contains a secret. */
export const nextStepPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open_url"), url: z.url(), expiresAt: z.number().int() }),
  z.object({
    kind: z.literal("device_code"),
    verificationUrl: z.url(),
    userCode: z.string().min(1),
    expiresAt: z.number().int(),
  }),
  z.object({
    kind: z.literal("paste_redirect"),
    url: z.url(),
    expiresAt: z.number().int(),
    /** What the user will paste: the full redirected URL, a displayed code, or either. */
    accepts: z.enum(["url", "code", "url_or_code"]),
  }),
  z.object({
    kind: z.literal("select_account"),
    options: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })).min(1),
  }),
  z.object({
    kind: z.literal("api_key"),
    keyPageUrl: z.url(),
    fields: z
      .array(z.object({ name: z.string().min(1), label: z.string().min(1), secret: z.boolean() }))
      .min(1),
  }),
  z.object({
    kind: z.literal("paste_file"),
    expectedFileName: z.string().min(1),
    hint: z.string(),
  }),
]);
export type NextStepPayload = z.infer<typeof nextStepPayloadSchema>;

/** One typed input from the browser. Consumed once; never logged or stored. */
export const submitInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("redirect"), value: z.string().min(1).max(8192) }),
  z.object({ kind: z.literal("code"), value: z.string().min(1).max(1024) }),
  z.object({
    kind: z.literal("api_key"),
    values: z.record(z.string(), z.string().min(1).max(8192)),
  }),
  z.object({ kind: z.literal("selection"), id: z.string().min(1) }),
  z.object({ kind: z.literal("file"), contents: z.string().min(1).max(1_048_576) }),
]);
export type SubmitInput = z.infer<typeof submitInputSchema>;

export interface Identity {
  readonly providerAccountId: string;
  readonly workspaceId: string | null;
  readonly label: string;
  /** `strong` when it comes from a token claim or identity endpoint; `weak` otherwise. */
  readonly assurance: "strong" | "weak";
}

export interface Capability {
  readonly metricOrAction: string;
  readonly availability: Availability;
  readonly interface: InterfaceLabel;
  readonly evidenceLevel: EvidenceLevel;
  readonly reason?: string;
}

export interface MetricObservation {
  readonly providerMetricKey: string;
  readonly kind: MetricKind;
  readonly scope: string;
  readonly valueText: string | null;
  readonly unit: string;
  readonly unlimited?: boolean;
  readonly windowStart?: number | null;
  readonly windowEnd?: number | null;
  readonly resetsAt?: number | null;
  readonly availability: Availability;
  readonly interface: InterfaceLabel;
}

export interface ResetCreditObservation {
  readonly providerCreditId: string;
  readonly eligible: boolean;
  readonly usable: boolean;
  readonly expiresAt?: number | null;
  readonly cooldownUntil?: number | null;
  readonly rawLabel?: string | null;
}

export interface CollectResult {
  /** When the provider says the data was true; defaults to now when unknown. */
  readonly observedAt: number;
  readonly metrics: readonly MetricObservation[];
  readonly resetCredits?: readonly ResetCreditObservation[];
  /** Per-metric failures that did not stop the rest of the collection. */
  readonly failures: readonly ClassifiedError[];
}

export interface ClassifiedError {
  readonly category: ErrorCategory;
  readonly class: FailureClass;
  /** Safe for the owner to read. Never a token, URL with a code, or response body. */
  readonly message: string;
  readonly retryAfterMs?: number;
}

export type ConnectProgress =
  | {
      readonly status: "next_step";
      readonly nextStep: NextStepPayload;
      readonly privateState: unknown;
      /**
       * When set, the application keeps calling `pollConnect` at this interval while the
       * step waits for the owner's input. A CLI login can finish on its own, for example
       * when the provider redirects to the CLI's loopback listener, and the pasted code
       * is then never needed.
       */
      readonly pollAfterMs?: number;
    }
  | { readonly status: "waiting"; readonly privateState: unknown; readonly pollAfterMs: number }
  | { readonly status: "credentials"; readonly credential: StoredCredential }
  | { readonly status: "error"; readonly error: ClassifiedError };

export type RefreshResult =
  | { readonly status: "refreshed"; readonly credential: StoredCredential }
  | { readonly status: "not_refreshable" }
  | { readonly status: "transient"; readonly error: ClassifiedError }
  | { readonly status: "rejected"; readonly error: ClassifiedError };

/** Defined in enums.ts; kept importable from here for the test doubles. */

/** One explicit, owner-confirmed mutation. The idempotency key is the action row id. */
export interface ActionRequest {
  readonly action: AccountActionKind;
  /** Provider credit id for `consume_reset_credit`. */
  readonly creditId: string | null;
  readonly idempotencyKey: string;
}

/**
 * `uncertain` means the request may have reached the provider and nothing proves whether it
 * applied; the owner reconciles from the next snapshot and nothing retries automatically.
 */
export type ActionResult =
  | {
      readonly status: "succeeded";
      readonly providerReference: string | null;
      readonly detail: string | null;
    }
  | { readonly status: "failed"; readonly error: ClassifiedError }
  | { readonly status: "uncertain"; readonly error: ClassifiedError };

export interface BeginConnectOptions {
  readonly attemptId: string;
  readonly method: string;
  /** Present for Reconnect: the new credentials must resolve to this identity. */
  readonly existingIdentity?: Identity;
  readonly expiresAt: number;
}

export interface Connector {
  readonly provider: Provider;
  readonly version: string;
  readonly interface: InterfaceLabel;
  readonly supportedMethods: readonly string[];

  beginConnect(options: BeginConnectOptions): Promise<ConnectProgress>;
  submitInput(privateState: unknown, input: SubmitInput): Promise<ConnectProgress>;
  pollConnect(privateState: unknown): Promise<ConnectProgress>;
  cancelConnect(privateState: unknown): Promise<void>;

  /** Actions `performAction` accepts; absent or empty means the connector has none. */
  readonly supportedActions?: readonly AccountActionKind[];
  performAction?(credential: StoredCredential, request: ActionRequest): Promise<ActionResult>;

  identity(credential: StoredCredential): Promise<Identity>;
  capabilities(credential: StoredCredential, identity: Identity): Promise<readonly Capability[]>;
  collect(credential: StoredCredential, identity: Identity): Promise<CollectResult>;
  refresh(credential: StoredCredential): Promise<RefreshResult>;
  disconnect(credential: StoredCredential): Promise<DisconnectResult>;
  classify(error: unknown): ClassifiedError;
}

/** Build a classified error from a category; the class comes from the canonical mapping. */
export function classified(
  category: ErrorCategory,
  message: string,
  retryAfterMs?: number,
): ClassifiedError {
  return retryAfterMs === undefined
    ? { category, class: errorCategoryClass[category], message }
    : { category, class: errorCategoryClass[category], message, retryAfterMs };
}

/** Thrown by connectors; the application classifies it with `connector.classify`. */
export class ConnectorError extends Error {
  constructor(
    readonly category: ErrorCategory,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ConnectorError";
  }

  toClassified(): ClassifiedError {
    return classified(this.category, this.message, this.retryAfterMs);
  }
}

/** Default classification for an unknown thrown value: transient, so state never changes by accident. */
export function classifyUnknown(error: unknown): ClassifiedError {
  if (error instanceof ConnectorError) return error.toClassified();
  // A request that timed out or was aborted says nothing about the account; retry it later.
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    return classified("provider_unavailable", "the provider request timed out");
  return classified("internal_error", "unexpected connector failure");
}
