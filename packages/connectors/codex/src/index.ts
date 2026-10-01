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
  type ResetCreditObservation,
  type StoredCredential,
  type SubmitInput,
  classifyUnknown,
} from "@headroom/core";

import {
  cli,
  clientId,
  resetCreditsHeaders,
  resetCreditsUrl,
  tokenUrl,
  usageHeaders,
  usageUrl,
} from "./endpoints.ts";
import {
  accessTokenClaimsSchema,
  authFileSchema,
  codexCredentialSchema,
  idTokenClaimsSchema,
  refreshErrorSchema,
  refreshResponseSchema,
  resetCreditsResponseSchema,
  usageResponseSchema,
  type CodexCredential,
  type UsageResponse,
} from "./schemas.ts";

export const codexConnectorVersion = "0.1.0";

/** Minimal fetch shape so tests can substitute a stub without casts. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CodexConnectorOptions {
  readonly runner: LoginRunner;
  readonly fetch?: FetchLike;
  /** Absolute path of the pinned codex binary; defaults to resolving `codex` on the runner's PATH. */
  readonly codexBinary?: string;
  readonly now?: () => number;
}

const privateStateSchema = z.object({ attemptId: z.string() });

/** Shared between `cli_login` and `import`: turn an auth.json body into a stored credential. */
export function credentialFromAuthFile(contents: string): StoredCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new ConnectorError("invalid_response", "the pasted file is not JSON");
  }
  const file = authFileSchema.safeParse(parsed);
  if (!file.success) {
    throw new ConnectorError(
      "invalid_response",
      "the file is not a Codex auth.json with ChatGPT tokens",
    );
  }
  const credential: CodexCredential = {
    idToken: file.data.tokens.id_token,
    accessToken: file.data.tokens.access_token,
    refreshToken: file.data.tokens.refresh_token,
    accountId: file.data.tokens.account_id ?? accountIdFromIdToken(file.data.tokens.id_token),
  };
  return { secret: credential, expiresAt: expiryOf(credential.accessToken) };
}

export function createCodexConnector(options: CodexConnectorOptions): Connector {
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
    if (status.state === "exited" || status.state === "killed") {
      await runner.cleanup(attemptId);
      return {
        status: "error",
        error: classified("approval_denied", "the sign-in did not complete"),
      };
    }
    return { status: "waiting", privateState: { attemptId }, pollAfterMs: 3000 };
  }

  return {
    provider: "codex",
    version: codexConnectorVersion,
    interface: "private",
    supportedMethods: ["cli_login", "import"],

    async beginConnect(begin: BeginConnectOptions): Promise<ConnectProgress> {
      if (begin.method === "import") {
        return {
          status: "next_step",
          nextStep: {
            kind: "paste_file",
            expectedFileName: "auth.json",
            hint: "From $CODEX_HOME (default ~/.codex) after `codex login`. Headroom encrypts it and never writes it back.",
          },
          privateState: { attemptId: begin.attemptId },
        };
      }
      runner.start({
        attemptId: begin.attemptId,
        command: [options.codexBinary ?? cli.command[0], ...cli.command.slice(1)],
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
          error: classified("provider_unavailable", "codex did not print a device code"),
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

    submitInput(privateState: unknown, input: SubmitInput): Promise<ConnectProgress> {
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
      if (!parsed.success) {
        return Promise.resolve({
          status: "error",
          error: classified("internal_error", "attempt state missing"),
        });
      }
      return finishCliLogin(parsed.data.attemptId);
    },

    async cancelConnect(privateState: unknown): Promise<void> {
      const parsed = privateStateSchema.safeParse(privateState);
      if (parsed.success) await runner.cleanup(parsed.data.attemptId);
    },

    async identity(credential: StoredCredential): Promise<Identity> {
      const secret = codexCredentialSchema.parse(credential.secret);
      const claims = idTokenClaimsSchema.safeParse(decodeJwt(secret.idToken));
      const auth = claims.success ? claims.data["https://api.openai.com/auth"] : undefined;
      const accountId = secret.accountId ?? auth?.chatgpt_account_id ?? null;
      if (!accountId) {
        throw new ConnectorError("invalid_response", "the id token carries no ChatGPT account id");
      }
      const email = claims.success ? claims.data.email : undefined;
      const plan = auth?.chatgpt_plan_type;
      return {
        providerAccountId: accountId,
        workspaceId: null,
        label: [email ?? "Codex", plan ? `(${plan})` : ""].filter(Boolean).join(" "),
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
        { metricOrAction: "rate_limit.primary_window", availability: "available", ...validated },
        {
          metricOrAction: "rate_limit.secondary_window",
          availability: "available",
          ...sourceInspected,
          reason: "null on the validated Pro account, which has one window",
        },
        {
          metricOrAction: "additional_rate_limits",
          availability: "available",
          ...sourceInspected,
          reason: "null on the validated account; present only with model-specific limits",
        },
        { metricOrAction: "credits", availability: "available", ...validated },
        {
          metricOrAction: "reset_credits",
          availability: "available",
          ...validated,
          reason: "count read from the usage body; the detail route is best effort",
        },
        {
          metricOrAction: "reset_credits.consume",
          availability: "unsupported",
          ...sourceInspected,
          reason: "actions arrive in M6",
        },
      ]);
    },

    async collect(credential: StoredCredential): Promise<CollectResult> {
      const secret = codexCredentialSchema.parse(credential.secret);
      const response = await http(usageUrl, {
        headers: usageHeaders(secret.accessToken, secret.accountId),
      });
      await throwForStatus(response, "usage");
      const usage = usageResponseSchema.safeParse(await response.json().catch(() => null));
      if (!usage.success)
        throw new ConnectorError("invalid_response", "usage response shape changed");
      const observedAt = now();
      const metrics = metricsFrom(usage.data);
      const failures: ClassifiedError[] = [];
      let resetCredits: ResetCreditObservation[] | undefined;
      try {
        const credits = await http(resetCreditsUrl, {
          headers: resetCreditsHeaders(secret.accessToken, secret.accountId),
        });
        await throwForStatus(credits, "reset credits");
        const parsed = resetCreditsResponseSchema.safeParse(await credits.json().catch(() => null));
        if (!parsed.success)
          throw new ConnectorError("invalid_response", "reset credits shape changed");
        resetCredits = (parsed.data.credits ?? []).map((credit, index) => ({
          providerCreditId: credit.id ?? `credit-${index}`,
          eligible: credit.status === undefined || credit.status === "available",
          usable: credit.status === undefined || credit.status === "available",
          expiresAt: toMs(credit.expires_at),
          rawLabel: credit.status ?? null,
        }));
        const count =
          parsed.data.available_count ?? usage.data.rate_limit_reset_credits?.available_count;
        if (count !== undefined) metrics.push(resetInventoryMetric(count));
      } catch (error) {
        const failure = classify(error);
        // The usage body carries the count; the detail route is best effort and never definitive here.
        failures.push(
          failure.class === "definitive" ? { ...failure, class: "capability" } : failure,
        );
        const count = usage.data.rate_limit_reset_credits?.available_count;
        if (count !== undefined) metrics.push(resetInventoryMetric(count));
      }
      return resetCredits === undefined
        ? { observedAt, metrics, failures }
        : { observedAt, metrics, resetCredits, failures };
    },

    async refresh(credential: StoredCredential): Promise<RefreshResult> {
      const secret = codexCredentialSchema.parse(credential.secret);
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: secret.refreshToken,
        scope: "openid profile email",
      });
      let response: Response;
      try {
        response = await http(tokenUrl, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body,
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
        const next: CodexCredential = {
          idToken: parsed.data.id_token ?? secret.idToken,
          accessToken: parsed.data.access_token,
          refreshToken: parsed.data.refresh_token ?? secret.refreshToken,
          accountId: secret.accountId,
        };
        return {
          status: "refreshed",
          credential: { secret: next, expiresAt: expiryOf(next.accessToken) },
        };
      }
      const error = refreshErrorSchema.safeParse(await response.json().catch(() => null));
      const code = error.success ? (error.data.error ?? "") : "";
      if (
        response.status === 400 ||
        response.status === 401 ||
        [
          "invalid_grant",
          "refresh_token_expired",
          "refresh_token_reused",
          "refresh_token_invalidated",
        ].includes(code)
      ) {
        return {
          status: "rejected",
          error: classified(
            "authentication_required",
            `refresh rejected: ${code || response.status}`,
          ),
        };
      }
      if (response.status === 429) {
        return {
          status: "transient",
          error: classified(
            "rate_limited",
            "token endpoint rate limited",
            retryAfterFrom(response),
          ),
        };
      }
      return {
        status: "transient",
        error: classified("provider_unavailable", `token endpoint returned ${response.status}`),
      };
    },

    disconnect(): Promise<DisconnectResult> {
      // No documented revocation route for ChatGPT device tokens; the credential row is deleted locally.
      return Promise.resolve("local_only");
    },

    classify,
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
    throw new ConnectorError("rate_limited", `${what} returned 429`, retryAfterFrom(response));
  if (response.status >= 500)
    throw new ConnectorError("provider_unavailable", `${what} returned ${response.status}`);
  throw new ConnectorError("invalid_response", `${what} returned ${response.status}`);
}

function retryAfterFrom(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

/** Parse the two lines the CLI prints: a verification URL and a one-time code. */
export function parseDeviceStep(output: string): { url: string; code: string } | null {
  const url = /https:\/\/auth\.openai\.com\/codex\/device\S*/.exec(output)?.[0];
  const code = /\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/.exec(output)?.[1];
  return url && code ? { url, code } : null;
}

function metricsFrom(usage: UsageResponse): MetricObservation[] {
  const metrics: MetricObservation[] = [];
  const windows: [string, UsageResponse["rate_limit"]][] = [["rate_limit", usage.rate_limit]];
  for (const extra of usage.additional_rate_limits ?? []) {
    const name = extra.limit_name ?? extra.metered_feature ?? "additional";
    windows.push([`additional.${name}`, extra.rate_limit]);
  }
  for (const [prefix, rateLimit] of windows) {
    for (const slot of ["primary_window", "secondary_window"] as const) {
      const window = rateLimit?.[slot];
      if (!window) continue;
      const seconds = window.limit_window_seconds;
      metrics.push({
        providerMetricKey: `${prefix}.${slot}`,
        kind: "quota_percentage",
        scope: seconds === undefined ? "window" : `window:${seconds}s`,
        valueText: window.used_percent === undefined ? null : String(window.used_percent),
        unit: "percent",
        resetsAt:
          window.reset_at === undefined
            ? window.reset_after_seconds === undefined
              ? null
              : null
            : window.reset_at * 1000,
        availability: window.used_percent === undefined ? "unknown" : "available",
        interface: "private",
      });
    }
  }
  if (usage.credits) {
    const balance = usage.credits.balance;
    metrics.push({
      providerMetricKey: "credits.balance",
      kind: "credits",
      scope: "account",
      valueText: balance === undefined ? null : String(balance),
      unit: "codex_credits",
      unlimited: usage.credits.unlimited ?? false,
      availability:
        balance === undefined && usage.credits.unlimited !== true ? "unknown" : "available",
      interface: "private",
    });
  }
  return metrics;
}

function resetInventoryMetric(count: number): MetricObservation {
  return {
    providerMetricKey: "reset_credits.available_count",
    kind: "reset_inventory",
    scope: "account",
    valueText: String(count),
    unit: "resets",
    availability: "available",
    interface: "private",
  };
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

function expiryOf(accessToken: string): number | null {
  const claims = accessTokenClaimsSchema.safeParse(decodeJwt(accessToken));
  return claims.success ? claims.data.exp * 1000 : null;
}

function accountIdFromIdToken(idToken: string): string | null {
  const claims = idTokenClaimsSchema.safeParse(decodeJwt(idToken));
  return claims.success
    ? (claims.data["https://api.openai.com/auth"]?.chatgpt_account_id ?? null)
    : null;
}

function toMs(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  if (typeof value === "number") return value > 1e12 ? value : value * 1000;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
