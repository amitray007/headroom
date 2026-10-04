import {
  accountActionKindSchema,
  accountActionStateSchema,
  attemptStateSchema,
  authMethodSchema,
  autoResetRuleSchema,
  availabilitySchema,
  connectionScopeSchema,
  connectionStateSchema,
  costSchema,
  disconnectResultSchema,
  evidenceLevelSchema,
  interfaceLabelSchema,
  nextStepPayloadSchema,
  notificationChannelTypeSchema,
  notificationDeliveryFailureSchema,
  notificationDeliveryStatusSchema,
  providerSchema,
  reconnectReasonSchema,
  settingsSchema,
  spendBudgetSchema,
  topUpSchema,
  type AutoResetRule,
  type Settings,
  type SubmitInput,
} from "@headroom/core/contracts";
import {
  metricSchema,
  overviewConnectionSchema,
  resetCreditSchema,
  type OverviewConnection,
} from "@headroom/view-model/overview";
import type { Cost, TopUp, WalletBook } from "@headroom/view-model/wallet";
import { z } from "zod";

import { devicePrefs } from "./lib/device-prefs.ts";

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

/** What a refused account change says. Callers that show `message` show this. */
export const demoRefusal = "Turn off Demo Mode to change accounts.";

/** Every id the demo generator makes starts with this. */
export function isDemoId(id: string): boolean {
  return id.startsWith("demo-");
}

export function isDemoRefusal(cause: unknown): boolean {
  return cause instanceof ApiError && cause.code === "demo_mode";
}

const demoOn = (): boolean => devicePrefs().getSnapshot().demo;

function refuseInDemo<T>(): Promise<T> {
  return Promise.reject(new ApiError(409, demoRefusal, "demo_mode"));
}

/** An account change: refused without a request while Demo Mode is on. */
function changesAccount<A extends unknown[], T>(
  call: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  return (...args) => (demoOn() ? refuseInDemo() : call(...args));
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

/** The server's exchange rates: units of each currency per 1 USD, fetched from the ECB. Null until a fetch works. */
const exchangeRatesSchema = z.object({
  base: z.literal("USD"),
  date: z.string().nullable(),
  fetchedAt: z.number().nullable(),
  perUsd: z.record(z.string(), z.number()).nullable(),
  error: z.string().nullable(),
});
export type ExchangeRatesPayload = z.infer<typeof exchangeRatesSchema>;

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

/** Owner preferences kept on the server; the schema is the backend's own. */
export type { Settings };
const settingsEnvelopeSchema = z.object({
  settings: settingsSchema,
});
export type SettingsEnvelope = z.infer<typeof settingsEnvelopeSchema>;

/** What the owner entered in the Wallet. The display currency lives in the settings. */
export type ServerWallet = Pick<WalletBook, "costs" | "topUps">;
const walletSchema: z.ZodType<ServerWallet> = z.object({
  costs: z.record(z.string(), costSchema),
  topUps: z.array(topUpSchema),
});
/** A top-up the owner is adding; the server assigns the id and records it as the owner's own. */
export type TopUpInput = Omit<TopUp, "id" | "source">;
/** The fields of a top-up the owner can change. The account and the source stay. */
export type TopUpUpdate = Omit<TopUpInput, "connectionId">;

const autoResetEnvelopeSchema = z.object({ autoReset: autoResetRuleSchema.nullable() });
const budgetsEnvelopeSchema = z.object({ budgets: z.array(spendBudgetSchema) });

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
const revocationSchema = z.object({ revocation: disconnectResultSchema });

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
const botSchema = z.object({ bot: z.object({ username: z.string() }) });
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
  | {
      readonly type: "webhook";
      readonly url: string;
      readonly includeIdentity: boolean;
      readonly secret?: string;
    };

/** A test send that saves nothing. Telegram uses a typed token or a saved channel's token. */
export type VerifyRequest =
  | { readonly type: "telegram"; readonly botToken: string; readonly chatId: string }
  | { readonly type: "telegram"; readonly channelId: string; readonly chatId: string }
  | { readonly type: "webhook"; readonly url: string; readonly secret: string };

/** The fields of a channel that can change. */
export interface ChannelPatch {
  readonly enabled?: boolean;
  readonly includeIdentity?: boolean;
  readonly botToken?: string;
  readonly chatId?: string;
  readonly chatTitle?: string;
  readonly url?: string;
  readonly secret?: string;
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
  checkBot: (botToken: string) =>
    request("POST", "/api/delivery/telegram/bot", botSchema, { botToken }),
  verifyDelivery: (body: VerifyRequest) =>
    request("POST", "/api/delivery/verify", testResultSchema, body),
  setup: () => request("GET", "/api/setup", setupSchema),
  me: () => request("GET", "/api/me", meSchema),
  providers: () => request("GET", "/api/providers", providersSchema),
  beginAttempt: changesAccount((provider: string, method: string) =>
    request("POST", "/api/attempts", attemptEnvelope, { provider, method }),
  ),
  attempt: (id: string) => request("GET", `/api/attempts/${id}`, attemptEnvelope),
  submitInput: (id: string, input: SubmitInput) =>
    request("POST", `/api/attempts/${id}/input`, attemptEnvelope, { input }),
  cancelAttempt: (id: string) => request("POST", `/api/attempts/${id}/cancel`, attemptEnvelope),
  connections: () => request("GET", "/api/connections", connectionListSchema),
  overview: () => request("GET", "/api/overview", overviewSchema),
  // Demo accounts have no server order; the page keeps the new order itself.
  saveOrder: (order: OrderBody) =>
    demoOn() ? Promise.resolve(order) : request("PUT", "/api/order", orderSchema, order),
  rename: changesAccount((id: string, name: string | null) =>
    request("PATCH", `/api/connections/${id}`, renameSchema, { name }),
  ),
  // Reading rates and asking the server to fetch them again touch no account, so Demo Mode allows both.
  exchangeRates: () => request("GET", "/api/exchange-rates", exchangeRatesSchema),
  wallet: () => request("GET", "/api/wallet", walletSchema),
  setCost: changesAccount((connectionId: string, cost: Cost) =>
    request("PUT", `/api/wallet/costs/${encodeURIComponent(connectionId)}`, walletSchema, cost),
  ),
  clearCost: changesAccount((connectionId: string) =>
    request("DELETE", `/api/wallet/costs/${encodeURIComponent(connectionId)}`, walletSchema),
  ),
  addTopUp: changesAccount((input: TopUpInput) =>
    request("POST", "/api/wallet/top-ups", walletSchema, input),
  ),
  updateTopUp: changesAccount((id: string, update: TopUpUpdate) =>
    request("PUT", `/api/wallet/top-ups/${encodeURIComponent(id)}`, walletSchema, update),
  ),
  removeTopUp: changesAccount((id: string) =>
    request("DELETE", `/api/wallet/top-ups/${encodeURIComponent(id)}`, walletSchema),
  ),
  settings: () => request("GET", "/api/settings", settingsEnvelopeSchema),
  saveSettings: (settings: Settings) =>
    request("PUT", "/api/settings", settingsEnvelopeSchema, settings),
  connection: (id: string) =>
    demoOn() && isDemoId(id)
      ? refuseInDemo<z.infer<typeof connectionDetailSchema>>()
      : request("GET", `/api/connections/${id}`, connectionDetailSchema),
  reconnect: changesAccount((id: string, method: string) =>
    request("POST", `/api/connections/${id}/reconnect`, attemptEnvelope, { method }),
  ),
  pause: changesAccount((id: string, paused: boolean) =>
    request("POST", `/api/connections/${id}/pause`, pauseSchema, { paused }),
  ),
  refresh: changesAccount((id: string) =>
    request("POST", `/api/connections/${id}/refresh`, refreshSchema),
  ),
  disconnect: changesAccount((id: string) =>
    request("DELETE", `/api/connections/${id}`, revocationSchema),
  ),
  setAutoReset: changesAccount((id: string, rule: AutoResetRule) =>
    request(
      "PUT",
      `/api/connections/${encodeURIComponent(id)}/auto-reset`,
      autoResetEnvelopeSchema,
      rule,
    ),
  ),
  clearAutoReset: changesAccount((id: string) =>
    request(
      "DELETE",
      `/api/connections/${encodeURIComponent(id)}/auto-reset`,
      autoResetEnvelopeSchema,
    ),
  ),
  setBudget: changesAccount((id: string, metricKey: string, amount: number) =>
    request(
      "PUT",
      `/api/connections/${encodeURIComponent(id)}/budgets/${encodeURIComponent(metricKey)}`,
      budgetsEnvelopeSchema,
      { amount },
    ),
  ),
  clearBudget: changesAccount((id: string, metricKey: string) =>
    request(
      "DELETE",
      `/api/connections/${encodeURIComponent(id)}/budgets/${encodeURIComponent(metricKey)}`,
      budgetsEnvelopeSchema,
    ),
  ),
  consumeResetCredit: changesAccount((id: string, creditId: string) =>
    request("POST", `/api/connections/${id}/actions`, actionOutcomeSchema, {
      action: "consume_reset_credit",
      creditId,
      confirm: true,
    }),
  ),
};
