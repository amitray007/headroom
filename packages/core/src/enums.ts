import { z } from "zod";

/**
 * Canonical enumerations from docs/architecture/data-model.md.
 * Dossiers, schema and API all use these names; nothing else may invent a state.
 */

export const connectionStates = ["ready", "partial", "reconnect_required", "paused"] as const;
export const connectionStateSchema = z.enum(connectionStates);
export type ConnectionState = z.infer<typeof connectionStateSchema>;

export const connectionScopes = ["individual", "member", "team_admin", "organization"] as const;
export const connectionScopeSchema = z.enum(connectionScopes);
export type ConnectionScope = z.infer<typeof connectionScopeSchema>;

export const authMethods = [
  "cli_login",
  "device_code",
  "paste_redirect",
  "approval_poll",
  "api_key",
  "import",
] as const;
export const authMethodSchema = z.enum(authMethods);
export type AuthMethod = z.infer<typeof authMethodSchema>;

export const attemptStates = [
  "created",
  "awaiting_user",
  "awaiting_input",
  "validating",
  "succeeded",
  "failed",
  "expired",
  "cancelled",
] as const;
export const attemptStateSchema = z.enum(attemptStates);
export type AttemptState = z.infer<typeof attemptStateSchema>;

export const terminalAttemptStates = [
  "succeeded",
  "failed",
  "expired",
  "cancelled",
] as const satisfies readonly AttemptState[];

export const nextSteps = [
  "open_url",
  "device_code",
  "paste_redirect",
  "select_account",
  "api_key",
  "paste_file",
] as const;
export const nextStepSchema = z.enum(nextSteps);
export type NextStep = z.infer<typeof nextStepSchema>;

export const interfaceLabels = ["official", "private"] as const;
export const interfaceLabelSchema = z.enum(interfaceLabels);
export type InterfaceLabel = z.infer<typeof interfaceLabelSchema>;

export const availabilities = [
  "available",
  "unsupported",
  "not_authorized",
  "temporarily_unavailable",
  "unknown",
] as const;
export const availabilitySchema = z.enum(availabilities);
export type Availability = z.infer<typeof availabilitySchema>;

export const evidenceLevels = [
  "documented",
  "source_inspected",
  "prior_observation",
  "validated",
  "unvalidated",
] as const;
export const evidenceLevelSchema = z.enum(evidenceLevels);
export type EvidenceLevel = z.infer<typeof evidenceLevelSchema>;

export const refreshStates = ["fresh", "refresh_due", "refresh_failed", "not_refreshable"] as const;
export const refreshStateSchema = z.enum(refreshStates);
export type RefreshState = z.infer<typeof refreshStateSchema>;

export const reconnectReasons = [
  "refresh_rejected",
  "token_rejected",
  "identity_changed",
  "revoked_by_owner",
] as const;
export const reconnectReasonSchema = z.enum(reconnectReasons);
export type ReconnectReason = z.infer<typeof reconnectReasonSchema>;

export const syncRunOutcomes = [
  "succeeded",
  "partial",
  "rate_limited",
  "provider_unavailable",
  "authentication_failed",
  "invalid_response",
  "interrupted",
] as const;
export const syncRunOutcomeSchema = z.enum(syncRunOutcomes);
export type SyncRunOutcome = z.infer<typeof syncRunOutcomeSchema>;

export const accountActionStates = [
  "requested",
  "submitted",
  "succeeded",
  "failed",
  "uncertain",
] as const;
export const accountActionStateSchema = z.enum(accountActionStates);
export type AccountActionState = z.infer<typeof accountActionStateSchema>;

/** Mutating account operations an owner can trigger explicitly. Never run by monitoring. */
export const accountActionKinds = ["consume_reset_credit"] as const;
export const accountActionKindSchema = z.enum(accountActionKinds);
export type AccountActionKind = z.infer<typeof accountActionKindSchema>;

export const metricKinds = [
  "quota_percentage",
  "absolute_quota",
  "currency_balance",
  "credits",
  "spend",
  "spending_cap",
  "reset_inventory",
  "reset_timestamp",
] as const;
export const metricKindSchema = z.enum(metricKinds);
export type MetricKind = z.infer<typeof metricKindSchema>;

export const providers = [
  "codex",
  "claude",
  "grok",
  "antigravity",
  "copilot",
  "cursor",
  "vercel_ai_gateway",
] as const;
export const providerSchema = z.enum(providers);
export type Provider = z.infer<typeof providerSchema>;

/** Failure classes from the connection lifecycle. Only `definitive` may change connection state. */
export const failureClasses = ["transient", "capability", "definitive"] as const;
export const failureClassSchema = z.enum(failureClasses);
export type FailureClass = z.infer<typeof failureClassSchema>;

export const errorCategories = [
  "approval_expired",
  "approval_denied",
  "authentication_required",
  "permission_denied",
  "rate_limited",
  "provider_unavailable",
  "unsupported_metric",
  "identity_mismatch",
  "invalid_response",
  "selection_required",
  "internal_error",
] as const;
export const errorCategorySchema = z.enum(errorCategories);
export type ErrorCategory = z.infer<typeof errorCategorySchema>;

/** The class each error category carries, per docs/architecture/connector-contract.md. */
export const errorCategoryClass: Readonly<Record<ErrorCategory, FailureClass>> = {
  approval_expired: "definitive",
  approval_denied: "definitive",
  authentication_required: "definitive",
  identity_mismatch: "definitive",
  permission_denied: "capability",
  unsupported_metric: "capability",
  invalid_response: "capability",
  selection_required: "capability",
  rate_limited: "transient",
  provider_unavailable: "transient",
  internal_error: "transient",
};
