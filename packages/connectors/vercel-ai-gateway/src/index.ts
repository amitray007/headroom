import {
  createGateway,
  GatewayAuthenticationError,
  GatewayError,
  GatewayForbiddenError,
  type GatewayProviderSettings,
  GatewayRateLimitError,
} from "@ai-sdk/gateway";
import { z } from "zod";

import {
  type BeginConnectOptions,
  type Capability,
  type ClassifiedError,
  type CollectResult,
  type ConnectProgress,
  type Connector,
  ConnectorError,
  type DisconnectResult,
  type Identity,
  type MetricObservation,
  type RefreshResult,
  type StoredCredential,
  type SubmitInput,
  classified,
  classifyUnknown,
  timeoutFetch,
} from "@headroom/core";

import { keyPageUrl } from "./endpoints.ts";

export const vercelConnectorVersion = "0.1.0";

/** The SDK's own fetch type, so tests can substitute a stub without casts. */
export type FetchLike = NonNullable<GatewayProviderSettings["fetch"]>;

export interface VercelConnectorOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  /** Days of spend report to request each collection. */
  readonly spendDays?: number;
}

const credentialSchema = z.object({ apiKey: z.string().min(1) });

/** The SDK already validates these; the schemas here pin what Headroom depends on. */
const creditsSchema = z.object({ balance: z.string(), totalUsed: z.string() });
const spendSchema = z.object({ results: z.array(z.object({ totalCost: z.number() }).loose()) });

export function createVercelConnector(options: VercelConnectorOptions = {}): Connector {
  const now = options.now ?? (() => Date.now());
  const spendDays = options.spendDays ?? 30;

  // A hung gateway request must not outlive the collection lease. The SDK's fetch type also carries
  // Bun's `preconnect`, which it never calls.
  const timedFetch: FetchLike = Object.assign(
    timeoutFetch(options.fetch ?? ((input, init) => fetch(input, init))),
    { preconnect: (): void => undefined },
  );

  function gateway(apiKey: string) {
    return createGateway({ apiKey, fetch: timedFetch });
  }

  return {
    provider: "vercel_ai_gateway",
    version: vercelConnectorVersion,
    interface: "official",
    supportedMethods: ["api_key"],

    beginConnect(begin: BeginConnectOptions): Promise<ConnectProgress> {
      return Promise.resolve({
        status: "next_step",
        nextStep: {
          kind: "api_key",
          keyPageUrl,
          fields: [{ name: "apiKey", label: "AI Gateway API key", secret: true }],
        },
        privateState: { attemptId: begin.attemptId },
      });
    },

    submitInput(_privateState: unknown, input: SubmitInput): Promise<ConnectProgress> {
      if (input.kind !== "api_key" || !input.values["apiKey"]) {
        return Promise.resolve({
          status: "error",
          error: classified("invalid_response", "expected an AI Gateway API key"),
        });
      }
      return Promise.resolve({
        status: "credentials",
        credential: { secret: { apiKey: input.values["apiKey"].trim() }, expiresAt: null },
      });
    },

    pollConnect(): Promise<ConnectProgress> {
      return Promise.resolve({
        status: "error",
        error: classified("internal_error", "api key flows do not poll"),
      });
    },

    cancelConnect(): Promise<void> {
      return Promise.resolve();
    },

    /** A Gateway key is scoped to one team; the key's own fingerprint is the stable identity. */
    async identity(credential: StoredCredential): Promise<Identity> {
      const { apiKey } = credentialSchema.parse(credential.secret);
      await call(() => gateway(apiKey).getCredits(), "credits");
      const fingerprint = new Bun.CryptoHasher("sha256").update(apiKey).digest("hex").slice(0, 16);
      return {
        providerAccountId: `gateway-key:${fingerprint}`,
        workspaceId: null,
        label: "Vercel AI Gateway",
        assurance: "weak",
      };
    },

    capabilities(): Promise<readonly Capability[]> {
      const documented = { interface: "official" as const, evidenceLevel: "documented" as const };
      return Promise.resolve([
        { metricOrAction: "credits.balance", availability: "available", ...documented },
        { metricOrAction: "credits.total_used", availability: "available", ...documented },
        {
          metricOrAction: "spend.report",
          availability: "unknown",
          ...documented,
          reason: "Pro and Enterprise plans only; probed on each collection",
        },
      ]);
    },

    async collect(credential: StoredCredential): Promise<CollectResult> {
      const { apiKey } = credentialSchema.parse(credential.secret);
      const client = gateway(apiKey);
      const credits = creditsSchema.parse(await call(() => client.getCredits(), "credits"));
      const observedAt = now();
      const metrics: MetricObservation[] = [
        {
          providerMetricKey: "credits.balance",
          kind: "credits",
          scope: "team",
          valueText: credits.balance,
          unit: "gateway_credits",
          availability: "available",
          interface: "official",
        },
        {
          providerMetricKey: "credits.total_used",
          kind: "credits",
          scope: "team",
          valueText: credits.totalUsed,
          unit: "gateway_credits",
          availability: "available",
          interface: "official",
        },
      ];
      const failures: ClassifiedError[] = [];
      const end = new Date(observedAt);
      const start = new Date(observedAt - spendDays * 24 * 60 * 60 * 1000);
      try {
        const report = spendSchema.parse(
          await call(
            () =>
              client.getSpendReport({
                startDate: isoDate(start),
                endDate: isoDate(end),
                groupBy: "day",
              }),
            "spend report",
          ),
        );
        const total = report.results.reduce((sum, row) => sum + row.totalCost, 0);
        metrics.push({
          providerMetricKey: `spend.${spendDays}d`,
          kind: "spend",
          scope: "team",
          valueText: total.toFixed(6),
          unit: "USD",
          windowStart: start.getTime(),
          windowEnd: end.getTime(),
          availability: "available",
          interface: "official",
        });
      } catch (error) {
        const failure = classify(error);
        // A spend report the plan does not include is a capability gap, never a reconnect.
        failures.push(
          failure.class === "definitive"
            ? { ...failure, category: "permission_denied", class: "capability" }
            : failure,
        );
        metrics.push({
          providerMetricKey: `spend.${spendDays}d`,
          kind: "spend",
          scope: "team",
          valueText: null,
          unit: "USD",
          availability: spendAvailability(failure),
          interface: "official",
        });
      }
      return { observedAt, metrics, failures };
    },

    refresh(): Promise<RefreshResult> {
      return Promise.resolve({ status: "not_refreshable" });
    },

    disconnect(): Promise<DisconnectResult> {
      // Keys are revoked in the Vercel dashboard; Headroom only forgets its copy.
      return Promise.resolve("local_only");
    },

    classify,
  };
}

async function call<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toConnectorError(error, what);
  }
}

function toConnectorError(error: unknown, what: string): ConnectorError {
  if (error instanceof ConnectorError) return error;
  if (error instanceof GatewayAuthenticationError) {
    return new ConnectorError("authentication_required", `${what}: key rejected`);
  }
  if (error instanceof GatewayForbiddenError)
    return new ConnectorError("permission_denied", `${what}: not permitted`);
  if (error instanceof GatewayRateLimitError) {
    return new ConnectorError("rate_limited", `${what}: rate limited`, 60_000);
  }
  if (error instanceof GatewayError) {
    // The SDK wraps most HTTP failures in a generic response error; the status code is the signal.
    const status = error.statusCode;
    if (status === 401)
      return new ConnectorError("authentication_required", `${what}: key rejected`);
    if (status === 403) return new ConnectorError("permission_denied", `${what}: not permitted`);
    if (status === 429) return new ConnectorError("rate_limited", `${what}: rate limited`, 60_000);
    if (status >= 500)
      return new ConnectorError("provider_unavailable", `${what}: gateway returned ${status}`);
    return new ConnectorError("invalid_response", `${what}: gateway returned ${status}`);
  }
  if (error instanceof z.ZodError)
    return new ConnectorError("invalid_response", `${what}: response shape changed`);
  return new ConnectorError("provider_unavailable", `${what}: request failed`);
}

function classify(error: unknown): ClassifiedError {
  return classifyUnknown(
    error instanceof ConnectorError ? error : toConnectorError(error, "gateway"),
  );
}

/**
 * Why the spend report is missing. Only a definitive refusal or a missing permission hides it as
 * not authorized; an outage or rate limit is temporary, and a changed response shape is unknown.
 */
function spendAvailability(failure: ClassifiedError): MetricObservation["availability"] {
  if (failure.category === "permission_denied" || failure.class === "definitive")
    return "not_authorized";
  if (failure.class === "transient") return "temporarily_unavailable";
  return "unknown";
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
