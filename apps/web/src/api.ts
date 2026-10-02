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
  nextStepPayloadSchema,
  notificationChannelTypeSchema,
  notificationDeliveryFailureSchema,
  notificationDeliveryStatusSchema,
  providerSchema,
  reconnectReasonSchema,
  type SubmitInput,
} from "@headroom/core/contracts";
import {
  metricSchema,
  overviewConnectionSchema,
  resetCreditSchema,
  type OverviewConnection,
} from "@headroom/view-model/overview";
import { z } from "zod";

export class ApiError extends Error {
  readonly status: number;
  /** The `error` word the server sent in its body, when it sent one. */
  readonly code: string | null;
  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
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

export type { OverviewConnection };
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

const overviewSchema = z.object({
  connections: z.array(overviewConnectionSchema),
  /** The effective order of every provider, including those with no accounts. */
  providerOrder: z.array(providerSchema),
  refreshIntervalMs: z.number(),
  staleAfterMs: z.number(),
});

const orderSchema = z.object({
  providers: z.array(providerSchema),
  accounts: z.record(z.string(), z.array(z.string())),
});
export type OrderBody = z.infer<typeof orderSchema>;

const renameSchema = z.object({ name: z.string().nullable() });

const refreshIntervalSchema = z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30)]);
const resetLeadSchema = z.union([z.literal(1), z.literal(3), z.literal(7)]);
const lowThresholdSchema = z.union([z.literal(30), z.literal(20), z.literal(15)]);
/** Owner preferences kept on the server. Mirrors the backend settings document. */
const settingsSchema = z.object({
  limitsView: z.enum(["used", "left"]),
  lowThresholdPercent: lowThresholdSchema,
  refreshIntervalMinutes: refreshIntervalSchema,
  timeStyle: z.enum(["countdown", "exact"]),
  clock: z.enum(["24h", "12h"]),
  density: z.enum(["comfortable", "compact"]),
  detailedOrder: z.enum(["urgency", "provider", "custom"]),
  keepInactiveLast: z.boolean(),
  accountActions: z.boolean(),
  notifications: z.object({
    runningLow: z.boolean(),
    expiringResets: z.boolean(),
    refreshFailures: z.boolean(),
    balances: z.boolean(),
    spend: z.boolean(),
    includeSessions: z.boolean(),
    resetLeadDays: resetLeadSchema,
    mutedProviders: z.array(providerSchema),
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

const channelSchema = z.object({
  id: z.string(),
  type: notificationChannelTypeSchema,
  enabled: z.boolean(),
  includeIdentity: z.boolean(),
  label: z.string(),
  createdAt: z.number(),
  lastDelivery: z
    .object({
      status: notificationDeliveryStatusSchema,
      at: z.number(),
      failure: notificationDeliveryFailureSchema.nullable(),
    })
    .nullable(),
});
export type ChannelView = z.infer<typeof channelSchema>;
const channelListSchema = z.object({ channels: z.array(channelSchema) });
const channelCreatedSchema = z.object({ channel: channelSchema, secret: z.string().optional() });
const channelEnvelopeSchema = z.object({ channel: channelSchema });
const testResultSchema = z.object({ ok: z.literal(true) });
const secretSchema = z.object({ secret: z.string() });
const chatsSchema = z.object({
  bot: z.object({ username: z.string() }),
  chats: z.array(z.object({ id: z.string(), title: z.string(), type: z.string() })),
});
export type FoundChat = z.infer<typeof chatsSchema>["chats"][number];

/** What a new channel needs. A Telegram channel needs a token and a chat; a webhook needs a URL. */
export type NewChannel =
  | {
      readonly type: "telegram";
      readonly botToken: string;
      readonly chatId: string;
      readonly chatTitle?: string;
      readonly includeIdentity: boolean;
    }
  | { readonly type: "webhook"; readonly url: string; readonly includeIdentity: boolean };

/** The fields of a channel that can change. */
export interface ChannelPatch {
  readonly enabled?: boolean;
  readonly includeIdentity?: boolean;
  readonly botToken?: string;
  readonly chatId?: string;
  readonly chatTitle?: string;
  readonly url?: string;
}

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
  if (!response.ok) {
    const failed = z
      .object({ error: z.string() })
      .safeParse(await response.json().catch(() => null));
    throw new ApiError(
      response.status,
      `Request failed (${response.status})`,
      failed.success ? failed.data.error : null,
    );
  }
  const parsed = schema.safeParse(response.status === 204 ? undefined : await response.json());
  if (!parsed.success) throw new ApiError(502, "The server sent an unexpected response");
  return parsed.data;
}

export const api = {
  channels: () => request("GET", "/api/delivery/channels", channelListSchema),
  createChannel: (channel: NewChannel) =>
    request("POST", "/api/delivery/channels", channelCreatedSchema, channel),
  updateChannel: (id: string, patch: ChannelPatch) =>
    request("PATCH", `/api/delivery/channels/${id}`, channelEnvelopeSchema, patch),
  deleteChannel: (id: string) => request("DELETE", `/api/delivery/channels/${id}`, z.undefined()),
  testChannel: (id: string) =>
    request("POST", `/api/delivery/channels/${id}/test`, testResultSchema),
  newChannelSecret: (id: string) =>
    request("POST", `/api/delivery/channels/${id}/secret`, secretSchema),
  findChats: (source: { readonly botToken: string } | { readonly channelId: string }) =>
    request("POST", "/api/delivery/telegram/chats", chatsSchema, source),
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
  saveOrder: (order: OrderBody) => request("PUT", "/api/order", orderSchema, order),
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
