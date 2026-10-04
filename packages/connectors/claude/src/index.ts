import { z } from "zod";

import {
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
  type ResetCreditObservation,
  type StoredCredential,
  type SubmitInput,
  classified,
  classifyUnknown,
  parseDate,
  retryAfterMs,
  throwForStatus,
  timeoutFetch,
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
  const http: FetchLike = options.fetch ?? timeoutFetch();
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
        return { status: "error", error: classifyUnknown(error) };
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
          return { status: "error", error: classifyUnknown(error) };
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
      throwForStatus(response, "profile");
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
      const validated = { interface: "private" as const, evidenceLevel: "validated" as const };
      return Promise.resolve([
        { metricOrAction: "five_hour", availability: "available", ...validated },
        { metricOrAction: "seven_day", availability: "available", ...validated },
        { metricOrAction: "limits.weekly_scoped", availability: "available", ...validated },
        {
          metricOrAction: "extra_usage",
          availability: "available",
          ...sourceInspected,
          reason: "collected while extra usage is switched on for the account",
        },
        {
          metricOrAction: "reset_grants",
          availability: "available",
          ...validated,
          reason: "count validated; the grant element shape is source-inspected",
        },
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
      throwForStatus(response, "usage");
      const usage = usageResponseSchema.safeParse(await response.json().catch(() => null));
      if (!usage.success)
        throw new ConnectorError("invalid_response", "usage response shape changed");
      const observedAt = now();
      const { metrics, resetCredits } = metricsFrom(usage.data, observedAt);
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

function metricsFrom(
  usage: UsageResponse,
  observedAt: number,
): {
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
    // Absent: not in this response. Null: the bucket does not apply to this account (validated
    // 2026-10-01 for the model buckets). Neither is a metric; an object without utilization is unknown.
    if (window === undefined || window === null) continue;
    metrics.push({
      providerMetricKey: key,
      kind: "quota_percentage",
      scope,
      valueText: window.utilization === undefined ? null : String(window.utilization),
      unit: "percent",
      resetsAt: parseDate(window.resets_at),
      availability: window.utilization === undefined ? "unknown" : "available",
      interface: "private",
    });
  }
  for (const limit of usage.limits ?? []) {
    if (limit.kind !== "weekly_scoped") continue;
    const name = limit.scope?.model?.display_name ?? "scoped";
    // JSON null and a missing field both mean the provider gave no number.
    const percent = limit.percent ?? undefined;
    metrics.push({
      providerMetricKey: `limits.${name}`,
      kind: "quota_percentage",
      scope: "window:604800s",
      valueText: percent === undefined ? null : String(percent),
      unit: "percent",
      resetsAt: parseDate(limit.resets_at),
      availability: percent === undefined ? "unknown" : "available",
      interface: "private",
    });
  }
  // Extra usage switched off on the account is not missing data: no spend metric is emitted and
  // the connection stays ready. The capability row says when the metric appears.
  if (usage.extra_usage?.is_enabled === true) {
    const usedCredits = usage.extra_usage.used_credits ?? undefined;
    const monthlyLimit = usage.extra_usage.monthly_limit ?? undefined;
    metrics.push({
      providerMetricKey: "extra_usage.used",
      kind: "spend",
      scope: "month",
      valueText: usedCredits === undefined ? null : centsToDollars(usedCredits),
      unit: "USD",
      availability: usedCredits === undefined ? "unknown" : "available",
      interface: "private",
    });
    if (monthlyLimit !== undefined && monthlyLimit > 0) {
      metrics.push({
        providerMetricKey: "extra_usage.monthly_limit",
        kind: "spending_cap",
        scope: "month",
        valueText: centsToDollars(monthlyLimit),
        unit: "USD",
        availability: "available",
        interface: "private",
      });
    }
  }
  const resetCredits: ResetCreditObservation[] = [];
  // An ineligible response (seen with ineligible_reason "surface" for the Claude Code sign-in) withholds the
  // grants rather than reporting none, so emit no count: an unavailable figure is unknown, not zero.
  if (usage.cedar_ember?.eligible === true) {
    let total = 0;
    let unknownCount = false;
    for (const [index, grant] of (usage.cedar_ember.grants ?? []).entries()) {
      const left = grant.resets_left;
      const startsAt = parseDate(grant.starts_at);
      const endsAt = parseDate(grant.ends_at);
      const active =
        grant.paused !== true &&
        (startsAt === null || startsAt <= observedAt) &&
        (endsAt === null || endsAt > observedAt);
      // A missing count is unknown, not zero. It only blurs the total when the grant could count at all.
      if (left === undefined && active) unknownCount = true;
      const usable = active && left !== undefined && left >= 1;
      if (usable) total += left;
      resetCredits.push({
        providerCreditId: `grant-${index}`,
        eligible: true,
        usable,
        expiresAt: endsAt,
        rawLabel: grant.label ?? (left === undefined ? "count unknown" : `${left} left`),
      });
    }
    metrics.push({
      providerMetricKey: "reset_grants.available",
      kind: "reset_inventory",
      scope: "account",
      valueText: unknownCount ? null : String(total),
      unit: "resets",
      availability: unknownCount ? "unknown" : "available",
      interface: "private",
    });
  }
  return { metrics, resetCredits };
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
