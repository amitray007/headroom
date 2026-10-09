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

/** Why a sign-in method cannot start on this host. Not stored; `/api/providers` reports it. */
export const methodUnavailableReasons = ["cli_not_installed"] as const;
export const methodUnavailableReasonSchema = z.enum(methodUnavailableReasons);
export type MethodUnavailableReason = z.infer<typeof methodUnavailableReasonSchema>;

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

/** Who started an account action: the owner from the dashboard, or an owner-configured automation rule (ADR 0003). */
export const accountActionOrigins = ["owner", "automation"] as const;
export const accountActionOriginSchema = z.enum(accountActionOrigins);
export type AccountActionOrigin = z.infer<typeof accountActionOriginSchema>;

/**
 * Changes Headroom noticed between two readings of one account, or an automation it ran.
 * See docs/decisions/0003-owner-automations.md.
 */
export const accountEventKinds = [
  "reset_granted",
  "early_reset",
  "top_up_detected",
  "auto_reset",
] as const;
export const accountEventKindSchema = z.enum(accountEventKinds);
export type AccountEventKind = z.infer<typeof accountEventKindSchema>;

/** Which limit windows an auto-reset rule watches: weekly or longer, 5-hour or shorter, or both. */
export const autoResetWindows = ["weekly", "session", "either"] as const;
export const autoResetWindowSchema = z.enum(autoResetWindows);
export type AutoResetWindow = z.infer<typeof autoResetWindowSchema>;

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

/** What a notification is about. See docs/architecture/notifications.md. */
export const notificationKinds = [
  "almost_out",
  "running_low",
  "reset_expiring",
  "balance_low",
  "spend_near_cap",
  "spend_cap_reached",
  "extra_usage_started",
  "refresh_failed",
  "disconnected",
  "reset_granted",
  "early_reset",
  "auto_reset",
  "top_up_detected",
  "budget_near",
  "budget_exceeded",
  "credits_expiring",
] as const;
export const notificationKindSchema = z.enum(notificationKinds);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationTones = ["bad", "warn", "info"] as const;
export const notificationToneSchema = z.enum(notificationTones);
export type NotificationTone = z.infer<typeof notificationToneSchema>;

/** The unit of a notification amount: US dollars, or a provider's own credit unit. Never converted between. */
export const notificationAmountUnits = [
  "USD",
  "codex_credits",
  "grok_credits",
  "gateway_credits",
  "credits",
] as const;
export const notificationAmountUnitSchema = z.enum(notificationAmountUnits);
export type NotificationAmountUnit = z.infer<typeof notificationAmountUnitSchema>;

/** Where a server-side notification goes. See docs/architecture/notifications.md, Delivery. */
export const notificationChannelTypes = ["telegram", "webhook"] as const;
export const notificationChannelTypeSchema = z.enum(notificationChannelTypes);
export type NotificationChannelType = z.infer<typeof notificationChannelTypeSchema>;

/** `failed` means Headroom gave up after the last retry. */
export const notificationDeliveryStatuses = ["delivered", "retrying", "failed"] as const;
export const notificationDeliveryStatusSchema = z.enum(notificationDeliveryStatuses);
export type NotificationDeliveryStatus = z.infer<typeof notificationDeliveryStatusSchema>;

/** Why one send attempt failed. A class only: no response body or credential is ever kept. */
export const notificationDeliveryFailures = [
  "timeout",
  "network",
  "unauthorized",
  "not_found",
  "rate_limited",
  "rejected",
  "server_error",
] as const;
export const notificationDeliveryFailureSchema = z.enum(notificationDeliveryFailures);
export type NotificationDeliveryFailure = z.infer<typeof notificationDeliveryFailureSchema>;

/** Currencies the Wallet records and converts. Exchange rates are fetched for exactly this list. */
export const currencies = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "CAD",
  "AUD",
  "JPY",
  "SGD",
  "CHF",
  "BRL",
] as const;
export const currencySchema = z.enum(currencies);
export type Currency = z.infer<typeof currencySchema>;

/** What the owner pays for a linked account. "Not set" is the absence of a row, never a stored value. */
export const walletCostKinds = ["paid", "free", "included"] as const;
export const walletCostKindSchema = z.enum(walletCostKinds);
export type WalletCostKind = z.infer<typeof walletCostKindSchema>;

export const billingCycles = ["monthly", "annual"] as const;
export const billingCycleSchema = z.enum(billingCycles);
export type BillingCycle = z.infer<typeof billingCycleSchema>;

export const topUpKinds = ["paid", "free"] as const;
export const topUpKindSchema = z.enum(topUpKinds);
export type TopUpKind = z.infer<typeof topUpKindSchema>;

/** Who recorded a top-up: the owner, or Headroom from a rise in a credit balance (ADR 0003). */
export const topUpSources = ["owner", "detected"] as const;
export const topUpSourceSchema = z.enum(topUpSources);
export type TopUpSource = z.infer<typeof topUpSourceSchema>;

/** What disconnecting a credential achieved at the provider. `local_only` means the provider offers no revoke. */
export const disconnectResults = ["revoked", "local_only", "failed"] as const;
export const disconnectResultSchema = z.enum(disconnectResults);
export type DisconnectResult = z.infer<typeof disconnectResultSchema>;
