import {
  accountActionKindSchema,
  accountActionStateSchema,
  attemptStateSchema,
  authMethodSchema,
  availabilitySchema,
  connectionScopeSchema,
  connectionStateSchema,
  evidenceLevelSchema,
  interfaceLabelSchema,
  metricKindSchema,
  nextStepPayloadSchema,
  providerSchema,
  reconnectReasonSchema,
  syncRunOutcomeSchema,
  type SubmitInput,
} from "@headroom/core/contracts";
import { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const setupSchema = z.object({
  ownerExists: z.boolean(),
  minimumPasswordLength: z.number(),
  minimumUsernameLength: z.number(),
});
const meSchema = z.object({ id: z.string(), name: z.string(), email: z.string() });
const providersSchema = z.object({
  providers: z.array(
    z.object({
      provider: providerSchema,
      version: z.string(),
      interface: interfaceLabelSchema,
      methods: z.array(authMethodSchema),
    }),
  ),
});

const attemptSchema = z.object({
  id: z.string(),
  provider: providerSchema,
  method: authMethodSchema,
  state: attemptStateSchema,
  nextStep: nextStepPayloadSchema.nullable(),
  error: z.string().nullable(),
  connectionId: z.string().nullable(),
  expiresAt: z.number(),
  pollAfterMs: z.number(),
});
const attemptEnvelope = z.object({ attempt: attemptSchema }).transform((body) => body.attempt);
export type Attempt = z.infer<typeof attemptSchema>;

const latestRunSchema = z.object({
  startedAt: z.number(),
  outcome: z.string().nullable(),
  error: z.string().nullable(),
});
const connectionSummarySchema = z.object({
  id: z.string(),
  provider: providerSchema,
  label: z.string(),
  scope: connectionScopeSchema,
  state: connectionStateSchema,
  reconnectReason: reconnectReasonSchema.nullable(),
  interface: interfaceLabelSchema,
  authMethod: authMethodSchema,
  lastSuccessAt: z.number().nullable(),
  stale: z.boolean(),
  latestRun: latestRunSchema.nullable(),
  metricCount: z.number(),
});
const connectionListSchema = z.object({ connections: z.array(connectionSummarySchema) });

const metricSchema = z.object({
  providerMetricKey: z.string(),
  kind: metricKindSchema,
  scope: z.string(),
  valueText: z.string().nullable(),
  valueNum: z.number().nullable(),
  unit: z.string(),
  unlimited: z.boolean().nullable().optional(),
  windowStart: z.number().nullable(),
  windowEnd: z.number().nullable(),
  resetsAt: z.number().nullable(),
  availability: availabilitySchema,
  interface: interfaceLabelSchema,
});
const resetCreditSchema = z.object({
  providerCreditId: z.string(),
  eligible: z.boolean(),
  usable: z.boolean(),
  expiresAt: z.number().nullable(),
  cooldownUntil: z.number().nullable(),
  rawLabel: z.string().nullable(),
});
export type Metric = z.infer<typeof metricSchema>;
export type ResetCredit = z.infer<typeof resetCreditSchema>;
const capabilitySchema = z.object({
  metricOrAction: z.string(),
  availability: availabilitySchema,
  interface: interfaceLabelSchema,
  evidenceLevel: evidenceLevelSchema,
  reason: z.string().nullable().optional(),
});
const connectionDetailSchema = z.object({
  connection: connectionSummarySchema.omit({ stale: true, latestRun: true, metricCount: true }),
  capabilities: z.array(capabilitySchema),
  snapshot: z
    .object({
      observedAt: z.number(),
      receivedAt: z.number(),
      connectorVersion: z.string(),
      metrics: z.array(metricSchema),
      resetCredits: z.array(resetCreditSchema),
    })
    .nullable(),
  latestRun: z
    .object({
      startedAt: z
        .union([z.number(), z.iso.datetime()])
        .transform((value) => new Date(value).getTime()),
      outcome: z.string().nullable(),
      sanitizedError: z.string().nullable(),
    })
    .nullable(),
  actions: z.object({ enabled: z.boolean(), supported: z.array(accountActionKindSchema) }),
});

const overviewConnectionSchema = z.object({
  id: z.string(),
  provider: providerSchema,
  scope: connectionScopeSchema,
  state: connectionStateSchema,
  reconnectReason: reconnectReasonSchema.nullable(),
  interface: interfaceLabelSchema,
  authMethod: authMethodSchema,
  name: z.string().nullable(),
  identity: z.string().nullable(),
  plan: z.string().nullable(),
  createdAt: z.number(),
  lastSuccessAt: z.number().nullable(),
  stale: z.boolean(),
  latestRun: z
    .object({
      startedAt: z.number(),
      finishedAt: z.number().nullable(),
      outcome: syncRunOutcomeSchema.nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
  snapshot: z
    .object({
      observedAt: z.number(),
      metrics: z.array(metricSchema),
      resetCredits: z.array(resetCreditSchema),
    })
    .nullable(),
  actions: z.object({ enabled: z.boolean(), supported: z.array(accountActionKindSchema) }),
});
export type OverviewConnection = z.infer<typeof overviewConnectionSchema>;
const overviewSchema = z.object({
  connections: z.array(overviewConnectionSchema),
  refreshIntervalMs: z.number(),
  staleAfterMs: z.number(),
});

const renameSchema = z.object({ name: z.string().nullable() });

const refreshIntervalSchema = z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]);
const lowThresholdSchema = z.union([z.literal(30), z.literal(20), z.literal(15)]);
/** Owner preferences kept on the server. Mirrors the backend settings document. */
const settingsSchema = z.object({
  limitsView: z.enum(["used", "left"]),
  lowThresholdPercent: lowThresholdSchema,
  refreshIntervalMinutes: refreshIntervalSchema,
  timeStyle: z.enum(["countdown", "exact"]),
  clock: z.enum(["24h", "12h"]),
  density: z.enum(["comfortable", "compact"]),
  accountActions: z.boolean(),
  notifications: z.object({
    runningLow: z.boolean(),
    expiringResets: z.boolean(),
    refreshFailures: z.boolean(),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;
const settingsEnvelopeSchema = z.object({
  settings: settingsSchema,
});
export type SettingsEnvelope = z.infer<typeof settingsEnvelopeSchema>;

const actionOutcomeSchema = z.object({
  action: z.object({
    id: z.string(),
    action: accountActionKindSchema,
    state: accountActionStateSchema,
    requestedAt: z.number(),
    completedAt: z.number().nullable(),
    providerReference: z.string().nullable(),
    sanitizedError: z.string().nullable(),
  }),
  state: connectionStateSchema.optional(),
});

const refreshSchema = z.object({ outcome: z.unknown(), state: connectionStateSchema });
const pauseSchema = z.object({ state: connectionStateSchema });
const revocationSchema = z.object({ revocation: z.enum(["revoked", "local_only", "failed"]) });

async function request<T>(
  method: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  } else if (method !== "GET") {
    init.headers = { "content-type": "application/json" };
  }
  const response = await fetch(path, init);
  if (!response.ok) throw new ApiError(response.status, `Request failed (${response.status})`);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new ApiError(502, "The server sent an unexpected response");
  return parsed.data;
}

export const api = {
  setup: () => request("GET", "/api/setup", setupSchema),
  me: () => request("GET", "/api/me", meSchema),
  providers: () => request("GET", "/api/providers", providersSchema),
  beginAttempt: (provider: string, method: string) =>
    request("POST", "/api/attempts", attemptEnvelope, { provider, method }),
  attempt: (id: string) => request("GET", `/api/attempts/${id}`, attemptEnvelope),
  submitInput: (id: string, input: SubmitInput) =>
    request("POST", `/api/attempts/${id}/input`, attemptEnvelope, { input }),
  cancelAttempt: (id: string) => request("POST", `/api/attempts/${id}/cancel`, attemptEnvelope),
  connections: () => request("GET", "/api/connections", connectionListSchema),
  overview: () => request("GET", "/api/overview", overviewSchema),
  rename: (id: string, name: string | null) =>
    request("PATCH", `/api/connections/${id}`, renameSchema, { name }),
  settings: () => request("GET", "/api/settings", settingsEnvelopeSchema),
  saveSettings: (settings: Settings) =>
    request("PUT", "/api/settings", settingsEnvelopeSchema, settings),
  connection: (id: string) => request("GET", `/api/connections/${id}`, connectionDetailSchema),
  reconnect: (id: string, method: string) =>
    request("POST", `/api/connections/${id}/reconnect`, attemptEnvelope, { method }),
  pause: (id: string, paused: boolean) =>
    request("POST", `/api/connections/${id}/pause`, pauseSchema, { paused }),
  refresh: (id: string) => request("POST", `/api/connections/${id}/refresh`, refreshSchema),
  disconnect: (id: string) => request("DELETE", `/api/connections/${id}`, revocationSchema),
  consumeResetCredit: (id: string, creditId: string) =>
    request("POST", `/api/connections/${id}/actions`, actionOutcomeSchema, {
      action: "consume_reset_credit",
      creditId,
      confirm: true,
    }),
};
