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
  type LoginRunner,
  type MetricObservation,
  type RefreshResult,
  type StoredCredential,
  type SubmitInput,
  classifyUnknown,
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
  const http: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const runner = options.runner;

  async function finishCliLogin(attemptId: string): Promise<ConnectProgress> {
    const status = runner.status(attemptId);
    if (!status)
      return {
        status: "error",
        error: classified("approval_expired", "the sign-in process is gone"),
      };
    if (status.credentialsPresent) {
      const contents = runner.readCredentials(attemptId);
      await runner.cleanup(attemptId);
      if (!contents)
        return {
          status: "error",
          error: classified("internal_error", "credentials file vanished"),
        };
      try {
        return { status: "credentials", credential: credentialFromAuthFile(contents) };
      } catch (error) {
        return { status: "error", error: classify(error) };
      }
    }
    if (status.state === "timed_out") {
      await runner.cleanup(attemptId);
      return {
        status: "error",
        error: classified("approval_expired", "the one-time code expired"),
      };
    }
    if (status.state !== "running") {
      await runner.cleanup(attemptId);
      return {
        status: "error",
        error: classified("approval_denied", "the sign-in did not complete"),
      };
    }
    return { status: "waiting", privateState: { attemptId }, pollAfterMs: 3000 };
  }

  return {
    provider: "grok",
    version: grokConnectorVersion,
    interface: "private",
    supportedMethods: ["cli_login", "import"],

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
      const deadline = now() + 20_000;
      let step = parseDeviceStep(runner.status(begin.attemptId)?.output ?? "");
      while (!step && now() < deadline) {
        // eslint-disable-next-line no-await-in-loop -- waiting on a child process's first lines
        await Bun.sleep(100);
        const status = runner.status(begin.attemptId);
        if (!status || status.state !== "running") break;
        step = parseDeviceStep(status.output);
      }
      if (!step) {
        await runner.cleanup(begin.attemptId);
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
        return Promise.resolve({ status: "error", error: classify(error) });
      }
    },

    pollConnect(privateState: unknown): Promise<ConnectProgress> {
      const parsed = privateStateSchema.safeParse(privateState);
      if (!parsed.success)
        return Promise.resolve({
          status: "error",
          error: classified("internal_error", "attempt state missing"),
        });
      return finishCliLogin(parsed.data.attemptId);
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
      return Promise.resolve([
        { metricOrAction: "weekly_pool", availability: "available", ...sourceInspected },
        { metricOrAction: "on_demand_cap", availability: "available", ...sourceInspected },
        { metricOrAction: "plan", availability: "available", ...sourceInspected },
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
      await throwForStatus(response, "billing");
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
          error: classified("rate_limited", "token endpoint rate limited", 60_000),
        };
      return {
        status: "transient",
        error: classified("provider_unavailable", `token endpoint returned ${response.status}`),
      };
    },

    disconnect(): Promise<DisconnectResult> {
      return Promise.resolve("local_only");
    },

    classify,
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

function classify(error: unknown): ClassifiedError {
  return classifyUnknown(error);
}

function classified(
  category: ClassifiedError["category"],
  message: string,
  retryAfterMs?: number,
): ClassifiedError {
  return new ConnectorError(category, message, retryAfterMs).toClassified();
}

async function throwForStatus(response: Response, what: string): Promise<void> {
  if (response.ok) return;
  if (response.status === 401)
    throw new ConnectorError("authentication_required", `${what} returned 401`);
  if (response.status === 403)
    throw new ConnectorError("permission_denied", `${what} returned 403`);
  if (response.status === 429)
    throw new ConnectorError("rate_limited", `${what} returned 429`, 60_000);
  if (response.status >= 500)
    throw new ConnectorError("provider_unavailable", `${what} returned ${response.status}`);
  throw new ConnectorError("invalid_response", `${what} returned ${response.status}`);
}

export function decodeJwt(token: string): unknown {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
  } catch {
    return null;
  }
}

function expiryOf(token: string): number | null {
  const claims = jwtClaimsSchema.safeParse(decodeJwt(token));
  return claims.success && claims.data.exp !== undefined ? claims.data.exp * 1000 : null;
}

function parseDate(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
