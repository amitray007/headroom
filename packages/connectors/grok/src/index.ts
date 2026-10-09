import { z } from "zod";

import {
  cliAvailability,
  type BeginConnectOptions,
  type Capability,
  type CollectResult,
  type ConnectProgress,
  type Connector,
  ConnectorError,
  type DisconnectResult,
  type Identity,
  type LoginRunner,
  type MetricObservation,
  type RefreshResult,
  type StoredCredential,
  type SubmitInput,
  awaitCliStep,
  classified,
  classifyUnknown,
  decodeJwt,
  expiryOf,
  finishCliLogin,
  parseDate,
  retryAfterMs,
  throwForStatus,
  timeoutFetch,
} from "@headroom/core";

import {
  apiHeaders,
  billingUrl,
  cli,
  defaultClientId,
  settingsUrl,
  tokenUrl,
} from "./endpoints.ts";
import {
  authFileSchema,
  billingResponseSchema,
  grokCredentialSchema,
  jwtClaimsSchema,
  refreshResponseSchema,
  settingsResponseSchema,
  type GrokCredential,
} from "./schemas.ts";

export const grokConnectorVersion = "0.1.0";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GrokConnectorOptions {
  readonly runner: LoginRunner;
  readonly fetch?: FetchLike;
  readonly grokBinary?: string;
  readonly now?: () => number;
}

const privateStateSchema = z.object({ attemptId: z.string() });

/** Turn the CLI's auth.json into a stored credential. Picks the first entry with an access token. */
export function credentialFromAuthFile(contents: string): StoredCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new ConnectorError("invalid_response", "the pasted file is not JSON");
  }
  const file = authFileSchema.safeParse(parsed);
  const entry = file.success ? Object.values(file.data).find((e) => e.key) : undefined;
  if (!entry?.key)
    throw new ConnectorError("invalid_response", "the file is not a Grok auth.json with a session");
  const credential: GrokCredential = {
    accessToken: entry.key,
    refreshToken: entry.refresh_token ?? entry.refresh ?? null,
    idToken: entry.id_token ?? null,
    clientId: entry.oidc_client_id ?? defaultClientId,
  };
  return {
    secret: credential,
    expiresAt: expiryOf(credential.accessToken) ?? parseDate(entry.expires_at ?? entry.expires),
  };
}

/** Parse the two lines the CLI prints on stderr: a verification URL carrying the code, and the code. */
export function parseDeviceStep(output: string): { url: string; code: string } | null {
  const url = /https:\/\/accounts\.x\.ai\/oauth2\/device\?user_code=([A-Za-z0-9_-]+)/.exec(output);
  if (!url) return null;
  return { url: url[0], code: url[1]! };
}

export function createGrokConnector(options: GrokConnectorOptions): Connector {
  const http: FetchLike = options.fetch ?? timeoutFetch();
  const now = options.now ?? (() => Date.now());
  const runner = options.runner;

  const finishLogin = (attemptId: string): Promise<ConnectProgress> =>
    finishCliLogin(runner, attemptId, {
      parse: credentialFromAuthFile,
      pollAfterMs: 3000,
      expiredMessage: "the one-time code expired",
    });

  return {
    provider: "grok",
    version: grokConnectorVersion,
    interface: "private",
    supportedMethods: ["cli_login", "import"],

    methodAvailability: (method) =>
      cliAvailability(method, cli.command[0], options.grokBinary ?? cli.command[0]),

    async beginConnect(begin: BeginConnectOptions): Promise<ConnectProgress> {
      if (begin.method === "import") {
        return {
          status: "next_step",
          nextStep: {
            kind: "paste_file",
            expectedFileName: "auth.json",
            hint: "From $GROK_HOME (default ~/.grok) after `grok login`. Headroom encrypts it and never writes it back.",
          },
          privateState: { attemptId: begin.attemptId },
        };
      }
      runner.start({
        attemptId: begin.attemptId,
        command: [options.grokBinary ?? cli.command[0], ...cli.command.slice(1)],
        homeVariable: cli.homeVariable,
        credentialFile: cli.credentialFile,
        timeoutMs: Math.min(cli.timeoutMs, Math.max(1000, begin.expiresAt - now())),
      });
      const step = await awaitCliStep(runner, begin.attemptId, {
        parse: parseDeviceStep,
        now,
        timeoutMs: 20_000,
      });
      if (!step) {
        return {
          status: "error",
          error: classified("provider_unavailable", "grok did not print a device code"),
        };
      }
      return {
        status: "next_step",
        nextStep: {
          kind: "device_code",
          verificationUrl: step.url,
          userCode: step.code,
          expiresAt: begin.expiresAt,
        },
        privateState: { attemptId: begin.attemptId },
      };
    },

    submitInput(_privateState: unknown, input: SubmitInput): Promise<ConnectProgress> {
      if (input.kind !== "file") {
        return Promise.resolve({
          status: "error",
          error: classified("invalid_response", "expected a pasted auth.json"),
        });
      }
      try {
        return Promise.resolve({
          status: "credentials",
          credential: credentialFromAuthFile(input.contents),
        });
      } catch (error) {
        return Promise.resolve({ status: "error", error: classifyUnknown(error) });
      }
    },

    pollConnect(privateState: unknown): Promise<ConnectProgress> {
      const parsed = privateStateSchema.safeParse(privateState);
      if (!parsed.success)
        return Promise.resolve({
          status: "error",
          error: classified("internal_error", "attempt state missing"),
        });
      return finishLogin(parsed.data.attemptId);
    },

    async cancelConnect(privateState: unknown): Promise<void> {
      const parsed = privateStateSchema.safeParse(privateState);
      if (parsed.success) await runner.cleanup(parsed.data.attemptId);
    },

    /** Identity is the token subject; the settings route supplies the plan for the label. */
    async identity(credential: StoredCredential): Promise<Identity> {
      const secret = grokCredentialSchema.parse(credential.secret);
      const claims = jwtClaimsSchema.safeParse(decodeJwt(secret.idToken ?? secret.accessToken));
      const subject = claims.success ? (claims.data.sub ?? null) : null;
      if (!subject) throw new ConnectorError("invalid_response", "the token carries no subject");
      const plan = await planName(http, secret.accessToken);
      const email = claims.success ? claims.data.email : undefined;
      return {
        providerAccountId: subject,
        workspaceId: null,
        label: [email ?? "Grok", plan ? `(${plan})` : ""].filter(Boolean).join(" "),
        assurance: "strong",
      };
    },

    capabilities(): Promise<readonly Capability[]> {
      const sourceInspected = {
        interface: "private" as const,
        evidenceLevel: "source_inspected" as const,
      };
      const validated = { interface: "private" as const, evidenceLevel: "validated" as const };
      return Promise.resolve([
        { metricOrAction: "weekly_pool", availability: "available", ...validated },
        { metricOrAction: "product_usage", availability: "available", ...validated },
        { metricOrAction: "on_demand_cap", availability: "available", ...validated },
        { metricOrAction: "on_demand_used", availability: "available", ...validated },
        { metricOrAction: "prepaid_balance", availability: "available", ...validated },
        { metricOrAction: "plan", availability: "available", ...validated },
        {
          metricOrAction: "reset_credits",
          availability: "unsupported",
          ...sourceInspected,
          reason: "no route known",
        },
      ]);
    },

    async collect(credential: StoredCredential): Promise<CollectResult> {
      const secret = grokCredentialSchema.parse(credential.secret);
      const response = await http(billingUrl, { headers: apiHeaders(secret.accessToken) });
      const observedAt = now();
      if (response.status === 412) {
        // Team or business principals have no personal pool. An account shape, not a failure.
        return {
          observedAt,
          metrics: [poolMetric(null, null, null, "not_authorized")],
          failures: [
            classified(
              "permission_denied",
              "this login has no personal team, so no weekly pool is exposed",
            ),
          ],
        };
      }
      throwForStatus(response, "billing");
      const billing = billingResponseSchema.safeParse(await response.json().catch(() => null));
      if (!billing.success)
        throw new ConnectorError("invalid_response", "billing response shape changed");
      const config = billing.data.config;
      const start = parseDate(config.currentPeriod.start);
      const end = parseDate(config.currentPeriod.end);
      const weekly = config.currentPeriod.type === "USAGE_PERIOD_TYPE_WEEKLY";
      const metrics: MetricObservation[] = [
        weekly
          ? poolMetric(String(config.creditUsagePercent ?? 0), start, end, "available")
          : poolMetric(null, start, end, "unsupported"),
        {
          providerMetricKey: "on_demand_cap",
          kind: "spending_cap",
          scope: "account",
          valueText: String(config.onDemandCap?.val ?? 0),
          unit: "grok_credits",
          availability: "available",
          interface: "private",
        },
      ];
      // Observed 2026-10-01: the billing body also carries on-demand spend, the prepaid balance and
      // per-product percentages of the same weekly pool. The body is proto-JSON, so a present wrapper
      // without a value is a real zero; only an absent wrapper is unknown (and emits no metric).
      if (config.onDemandUsed !== undefined)
        metrics.push({
          providerMetricKey: "on_demand.used",
          kind: "spend",
          scope: "window:weekly",
          valueText: String(config.onDemandUsed.val ?? 0),
          unit: "grok_credits",
          windowStart: start,
          windowEnd: end,
          availability: "available",
          interface: "private",
        });
      if (config.prepaidBalance !== undefined)
        metrics.push({
          providerMetricKey: "prepaid_balance",
          kind: "credits",
          scope: "account",
          valueText: String(config.prepaidBalance.val ?? 0),
          unit: "grok_credits",
          availability: "available",
          interface: "private",
        });
      for (const product of config.productUsage ?? []) {
        const key = product.product.replace(/[^A-Za-z0-9_-]+/g, "_");
        if (key === "") continue;
        metrics.push({
          providerMetricKey: `product.${key}.used_percent`,
          kind: "quota_percentage",
          scope: "window:weekly",
          valueText: String(product.usagePercent ?? 0),
          unit: "percent",
          windowStart: start,
          windowEnd: end,
          resetsAt: end,
          availability: "available",
          interface: "private",
        });
      }
      return { observedAt, metrics, failures: [] };
    },

    async refresh(credential: StoredCredential): Promise<RefreshResult> {
      const secret = grokCredentialSchema.parse(credential.secret);
      if (!secret.refreshToken) return { status: "not_refreshable" };
      let response: Response;
      try {
        response = await http(tokenUrl, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: secret.clientId,
            refresh_token: secret.refreshToken,
          }),
        });
      } catch {
        return {
          status: "transient",
          error: classified("provider_unavailable", "token endpoint unreachable"),
        };
      }
      if (response.ok) {
        const parsed = refreshResponseSchema.safeParse(await response.json().catch(() => null));
        if (!parsed.success)
          return {
            status: "transient",
            error: classified("invalid_response", "refresh response shape changed"),
          };
        const next: GrokCredential = {
          accessToken: parsed.data.access_token,
          refreshToken: parsed.data.refresh_token ?? secret.refreshToken,
          idToken: parsed.data.id_token ?? secret.idToken,
          clientId: secret.clientId,
        };
        const expiresAt =
          expiryOf(next.accessToken) ??
          (parsed.data.expires_in === undefined ? null : now() + parsed.data.expires_in * 1000);
        return { status: "refreshed", credential: { secret: next, expiresAt } };
      }
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return {
          status: "rejected",
          error: classified("authentication_required", `refresh rejected: ${response.status}`),
        };
      }
      if (response.status === 429)
        return {
          status: "transient",
          error: classified("rate_limited", "token endpoint rate limited", retryAfterMs(response)),
        };
      return {
        status: "transient",
        error: classified("provider_unavailable", `token endpoint returned ${response.status}`),
      };
    },

    disconnect(): Promise<DisconnectResult> {
      return Promise.resolve("local_only");
    },

    classify: classifyUnknown,
  };
}

async function planName(http: FetchLike, accessToken: string): Promise<string | null> {
  try {
    const response = await http(settingsUrl, { headers: apiHeaders(accessToken) });
    if (!response.ok) return null;
    const parsed = settingsResponseSchema.safeParse(await response.json().catch(() => null));
    const plan = parsed.success ? parsed.data.subscription_tier_display?.trim() : undefined;
    return plan ? plan : null;
  } catch {
    return null;
  }
}

function poolMetric(
  valueText: string | null,
  windowStart: number | null,
  windowEnd: number | null,
  availability: MetricObservation["availability"],
): MetricObservation {
  return {
    providerMetricKey: "weekly_pool.used_percent",
    kind: "quota_percentage",
    scope: "window:weekly",
    valueText,
    unit: "percent",
    windowStart,
    windowEnd,
    resetsAt: windowEnd,
    availability,
    interface: "private",
  };
}
