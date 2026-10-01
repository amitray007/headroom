import {
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
  type SubmitInput,
} from "@headroom/core/contracts";
import { z } from "zod";

class ApiError extends Error {
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
  outcome: z.string(),
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
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;
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
});

const refreshSchema = z.object({ outcome: z.unknown(), state: connectionStateSchema });
const pauseSchema = z.object({ state: connectionStateSchema });
const revocationSchema = z.object({ revocation: z.enum(["revoked", "local_only", "failed"]) });
export type Revocation = z.infer<typeof revocationSchema>["revocation"];

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
  connection: (id: string) => request("GET", `/api/connections/${id}`, connectionDetailSchema),
  reconnect: (id: string, method: string) =>
    request("POST", `/api/connections/${id}/reconnect`, attemptEnvelope, { method }),
  pause: (id: string, paused: boolean) =>
    request("POST", `/api/connections/${id}/pause`, pauseSchema, { paused }),
  refresh: (id: string) => request("POST", `/api/connections/${id}/refresh`, refreshSchema),
  disconnect: (id: string) => request("DELETE", `/api/connections/${id}`, revocationSchema),
};
