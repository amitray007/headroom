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
  oauthHeaders,
  profileUrl,
  scopes,
  tokenUrl,
  usageUrl,
} from "./endpoints.ts";
import {
  claudeCredentialSchema,
  credentialsFileSchema,
  profileSchema,
  refreshResponseSchema,
  usageResponseSchema,
  type ClaudeCredential,
  type UsageResponse,
} from "./schemas.ts";

export const claudeConnectorVersion = "0.1.0";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClaudeConnectorOptions {
  readonly runner: LoginRunner;
  readonly fetch?: FetchLike;
  readonly claudeBinary?: string;
  readonly now?: () => number;
}

const privateStateSchema = z.object({ attemptId: z.string() });

/** Turn Claude Code's `.credentials.json` into a stored credential. */
export function credentialFromCredentialsFile(contents: string): StoredCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new ConnectorError("invalid_response", "the pasted file is not JSON");
  }
  const file = credentialsFileSchema.safeParse(parsed);
  if (!file.success)
    throw new ConnectorError("invalid_response", "the file is not a Claude Code .credentials.json");
  const oauth = file.data.claudeAiOauth;
  const credential: ClaudeCredential = {
    accessToken: oauth.accessToken,
    refreshToken: oauth.refreshToken ?? null,
    subscriptionType: oauth.subscriptionType ?? null,
    scopes: oauth.scopes ?? [],
  };
  return { secret: credential, expiresAt: oauth.expiresAt ?? null };
}

/** The headless CLI prints "visit: <authorize url>" and then waits for a pasted code. */
export function parseAuthorizeUrl(output: string): string | null {
  return /https:\/\/claude\.com\/cai\/oauth\/authorize\?\S+/.exec(output)?.[0] ?? null;
}

/** What the CLI expects on stdin: the displayed `code#state`, or the same two values taken from a redirected URL. */
export function codeFromInput(input: SubmitInput): string | null {
  if (input.kind === "code") return input.value.trim();
  if (input.kind !== "redirect") return null;
  try {
    const url = new URL(input.value.trim());
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code) return null;
    return state ? `${code}#${state}` : code;
  } catch {
    return null;
  }
}

export function createClaudeConnector(options: ClaudeConnectorOptions): Connector {
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
        return { status: "credentials", credential: credentialFromCredentialsFile(contents) };
      } catch (error) {
        return { status: "error", error: classify(error) };
      }
    }
    if (status.state === "timed_out") {
      await runner.cleanup(attemptId);
      return { status: "error", error: classified("approval_expired", "the sign-in timed out") };
    }
    if (status.state !== "running") {
      await runner.cleanup(attemptId);
      return {
        status: "error",
        error: classified("approval_denied", "the sign-in did not complete"),
      };
    }
    return { status: "waiting", privateState: { attemptId }, pollAfterMs: 2000 };
  }

  return {
    provider: "claude",
    version: claudeConnectorVersion,
    interface: "private",
    supportedMethods: ["cli_login", "import"],

    async beginConnect(begin: BeginConnectOptions): Promise<ConnectProgress> {
      if (begin.method === "import") {
        return {
          status: "next_step",
          nextStep: {
            kind: "paste_file",
            expectedFileName: ".credentials.json",
            hint: "From $CLAUDE_CONFIG_DIR (default ~/.claude) after `claude auth login`. Headroom encrypts it and never writes it back.",
          },
          privateState: { attemptId: begin.attemptId },
        };
      }
      runner.start({
        attemptId: begin.attemptId,
        command: [options.claudeBinary ?? cli.command[0], ...cli.command.slice(1)],
        homeVariable: cli.homeVariable,
        credentialFile: cli.credentialFile,
        timeoutMs: Math.min(cli.timeoutMs, Math.max(1000, begin.expiresAt - now())),
      });
      const deadline = now() + 30_000;
      let url = parseAuthorizeUrl(runner.status(begin.attemptId)?.output ?? "");
      while (!url && now() < deadline) {
        // eslint-disable-next-line no-await-in-loop -- waiting on a child process's first lines
        await Bun.sleep(100);
        const status = runner.status(begin.attemptId);
        if (!status || status.state !== "running") break;
        url = parseAuthorizeUrl(status.output);
      }
      if (!url) {
        await runner.cleanup(begin.attemptId);
        return {
          status: "error",
          error: classified("provider_unavailable", "claude did not print an authorization URL"),
        };
      }
      // The CLI also runs a loopback callback listener. It cannot receive a browser on another
      // device, and the runner's browser shim stops it opening one on the server, but if the
      // CLI ever completes on its own the next poll must notice the credentials file.
      return {
        status: "next_step",
        nextStep: {
          kind: "paste_redirect",
          url,
          expiresAt: begin.expiresAt,
          accepts: "url_or_code",
        },
        privateState: { attemptId: begin.attemptId },
        pollAfterMs: 2000,
      };
    },

    async submitInput(privateState: unknown, input: SubmitInput): Promise<ConnectProgress> {
      if (input.kind === "file") {
        try {
          return {
            status: "credentials",
            credential: credentialFromCredentialsFile(input.contents),
          };
        } catch (error) {
          return { status: "error", error: classify(error) };
        }
      }
      const parsed = privateStateSchema.safeParse(privateState);
      const code = codeFromInput(input);
      if (!parsed.success || !code) {
        return {
          status: "error",
          error: classified("invalid_response", "expected the code from the authorization page"),
        };
      }
      try {
        runner.write(parsed.data.attemptId, code);
      } catch {
        return {
          status: "error",
          error: classified("approval_expired", "the sign-in process is gone"),
        };
      }
      // The CLI exchanges the code and writes the credentials file; the next poll picks it up.
      await Bun.sleep(500);
      const progress = await finishCliLogin(parsed.data.attemptId);
      return progress.status === "waiting" ? { ...progress, pollAfterMs: 1000 } : progress;
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

    async identity(credential: StoredCredential): Promise<Identity> {
      const secret = claudeCredentialSchema.parse(credential.secret);
      const response = await http(profileUrl, { headers: oauthHeaders(secret.accessToken) });
      await throwForStatus(response, "profile");
      const profile = profileSchema.safeParse(await response.json().catch(() => null));
      if (!profile.success)
        throw new ConnectorError("invalid_response", "profile response shape changed");
      const plan = secret.subscriptionType;
      return {
        providerAccountId: profile.data.account.uuid,
        workspaceId: profile.data.organization?.uuid ?? null,
        label: [profile.data.account.email ?? "Claude", plan ? `(${plan})` : ""]
          .filter(Boolean)
          .join(" "),
        assurance: "strong",
      };
    },

    capabilities(): Promise<readonly Capability[]> {
      const sourceInspected = {
        interface: "private" as const,
        evidenceLevel: "source_inspected" as const,
      };
      return Promise.resolve([
        { metricOrAction: "five_hour", availability: "available", ...sourceInspected },
        { metricOrAction: "seven_day", availability: "available", ...sourceInspected },
        { metricOrAction: "limits.weekly_scoped", availability: "available", ...sourceInspected },
        { metricOrAction: "extra_usage", availability: "available", ...sourceInspected },
        { metricOrAction: "reset_grants", availability: "available", ...sourceInspected },
        {
          metricOrAction: "reset_grants.redeem",
          availability: "unsupported",
          ...sourceInspected,
          reason: "no documented action",
        },
      ]);
    },

    async collect(credential: StoredCredential): Promise<CollectResult> {
      const secret = claudeCredentialSchema.parse(credential.secret);
      const response = await http(usageUrl, { headers: oauthHeaders(secret.accessToken) });
      await throwForStatus(response, "usage");
      const usage = usageResponseSchema.safeParse(await response.json().catch(() => null));
      if (!usage.success)
        throw new ConnectorError("invalid_response", "usage response shape changed");
      const observedAt = now();
      const { metrics, resetCredits } = metricsFrom(usage.data);
      return { observedAt, metrics, resetCredits, failures: [] };
    },

    async refresh(credential: StoredCredential): Promise<RefreshResult> {
      const secret = claudeCredentialSchema.parse(credential.secret);
      if (!secret.refreshToken) return { status: "not_refreshable" };
      let response: Response;
      try {
        response = await http(tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: secret.refreshToken,
            client_id: clientId,
            scope: scopes,
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
        const next: ClaudeCredential = {
          accessToken: parsed.data.access_token,
          refreshToken: parsed.data.refresh_token ?? secret.refreshToken,
          subscriptionType: secret.subscriptionType,
          scopes: secret.scopes,
        };
        const expiresAt =
          parsed.data.expires_in === undefined ? null : now() + parsed.data.expires_in * 1000;
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

function metricsFrom(usage: UsageResponse): {
  metrics: MetricObservation[];
  resetCredits: ResetCreditObservation[];
} {
  const metrics: MetricObservation[] = [];
  const windows: [string, string, UsageResponse["five_hour"]][] = [
    ["five_hour", "window:18000s", usage.five_hour],
    ["seven_day", "window:604800s", usage.seven_day],
    ["seven_day_sonnet", "window:604800s", usage.seven_day_sonnet],
  ];
  for (const [key, scope, window] of windows) {
    if (window === undefined) continue;
    metrics.push({
      providerMetricKey: key,
      kind: "quota_percentage",
      scope,
      valueText: window?.utilization === undefined ? null : String(window.utilization),
      unit: "percent",
      resetsAt: parseDate(window?.resets_at),
      availability: window?.utilization === undefined ? "unknown" : "available",
      interface: "private",
    });
  }
  for (const limit of usage.limits ?? []) {
    if (limit.kind !== "weekly_scoped") continue;
    const name = limit.scope?.model?.display_name ?? "scoped";
    metrics.push({
      providerMetricKey: `limits.${name}`,
      kind: "quota_percentage",
      scope: "window:604800s",
      valueText: limit.percent === undefined ? null : String(limit.percent),
      unit: "percent",
      resetsAt: parseDate(limit.resets_at),
      availability: limit.percent === undefined ? "unknown" : "available",
      interface: "private",
    });
  }
  if (usage.extra_usage) {
    const enabled = usage.extra_usage.is_enabled === true;
    metrics.push({
      providerMetricKey: "extra_usage.used",
      kind: "spend",
      scope: "month",
      valueText:
        enabled && usage.extra_usage.used_credits !== undefined
          ? centsToDollars(usage.extra_usage.used_credits)
          : null,
      unit: "USD",
      availability: enabled
        ? usage.extra_usage.used_credits === undefined
          ? "unknown"
          : "available"
        : "unsupported",
      interface: "private",
    });
    if (
      enabled &&
      usage.extra_usage.monthly_limit !== undefined &&
      usage.extra_usage.monthly_limit > 0
    ) {
      metrics.push({
        providerMetricKey: "extra_usage.monthly_limit",
        kind: "spending_cap",
        scope: "month",
        valueText: centsToDollars(usage.extra_usage.monthly_limit),
        unit: "USD",
        availability: "available",
        interface: "private",
      });
    }
  }
  const resetCredits: ResetCreditObservation[] = [];
  if (usage.cedar_ember) {
    const eligible = usage.cedar_ember.eligible === true;
    let total = 0;
    (usage.cedar_ember.grants ?? []).forEach((grant, index) => {
      const left = grant.resets_left ?? 0;
      total += Math.max(0, left);
      resetCredits.push({
        providerCreditId: `grant-${index}`,
        eligible,
        usable: eligible && left >= 1,
        expiresAt: parseDate(grant.ends_at),
        rawLabel: `${left} left`,
      });
    });
    metrics.push({
      providerMetricKey: "reset_grants.available",
      kind: "reset_inventory",
      scope: "account",
      valueText: String(eligible ? total : 0),
      unit: "resets",
      availability: "available",
      interface: "private",
    });
  }
  return { metrics, resetCredits };
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
  if (response.status === 429) {
    const header = Number(response.headers.get("retry-after"));
    throw new ConnectorError(
      "rate_limited",
      `${what} returned 429`,
      Number.isFinite(header) && header > 0 ? header * 1000 : 60_000,
    );
  }
  if (response.status >= 500)
    throw new ConnectorError("provider_unavailable", `${what} returned ${response.status}`);
  throw new ConnectorError("invalid_response", `${what} returned ${response.status}`);
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
