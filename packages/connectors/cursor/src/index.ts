import { createHash, randomBytes, randomUUID } from "node:crypto";

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
  classified,
  classifyUnknown,
  decodeJwt,
  expiryOf,
  parseDate,
  retryAfterMs,
  throwForStatus,
  timeoutFetch,
} from "@headroom/core";

import {
  grokBotUsageUrl,
  loginUrl,
  pollUrl,
  refreshUrl,
  rpcHeaders,
  usageUrl,
} from "./endpoints.ts";
import {
  cursorCredentialSchema,
  grokBotUsageSchema,
  jwtClaimsSchema,
  periodUsageSchema,
  tokenResponseSchema,
  type CursorCredential,
  type GrokBotUsage,
  type PeriodUsage,
} from "./schemas.ts";

export const cursorConnectorVersion = "0.1.0";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CursorConnectorOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  /** Test hook for deterministic PKCE and request ids. */
  readonly randomness?: () => { verifier: string; uuid: string };
}

const privateStateSchema = z.object({ verifier: z.string().min(1), uuid: z.string().min(1) });

/** PKCE as pi-cursor does it: 96 random bytes, S256 challenge, both base64url. */
export function pkce(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildLoginUrl(challenge: string, uuid: string): string {
  const url = new URL(loginUrl);
  url.searchParams.set("challenge", challenge);
  url.searchParams.set("uuid", uuid);
  url.searchParams.set("mode", "login");
  url.searchParams.set("redirectTarget", "cli");
  return url.toString();
}

export function createCursorConnector(options: CursorConnectorOptions = {}): Connector {
  const http: FetchLike = options.fetch ?? timeoutFetch();
  const now = options.now ?? (() => Date.now());
  const randomness =
    options.randomness ??
    (() => ({ verifier: randomBytes(96).toString("base64url"), uuid: randomUUID() }));

  return {
    provider: "cursor",
    version: cursorConnectorVersion,
    interface: "private",
    supportedMethods: ["approval_poll"],

    beginConnect(begin: BeginConnectOptions): Promise<ConnectProgress> {
      const { verifier, uuid } = randomness();
      return Promise.resolve({
        status: "next_step",
        nextStep: {
          kind: "open_url",
          url: buildLoginUrl(pkce(verifier), uuid),
          expiresAt: begin.expiresAt,
        },
        privateState: { verifier, uuid },
      });
    },

    submitInput(): Promise<ConnectProgress> {
      return Promise.resolve({
        status: "error",
        error: classified("invalid_response", "this flow takes no input; approve in the browser"),
      });
    },

    async pollConnect(privateState: unknown): Promise<ConnectProgress> {
      const parsed = privateStateSchema.safeParse(privateState);
      if (!parsed.success)
        return { status: "error", error: classified("internal_error", "attempt state missing") };
      const url = `${pollUrl}?uuid=${encodeURIComponent(parsed.data.uuid)}&verifier=${encodeURIComponent(parsed.data.verifier)}`;
      let response: Response;
      try {
        response = await http(url, {
          headers: { accept: "application/json", "user-agent": "Headroom" },
        });
      } catch {
        return { status: "waiting", privateState: parsed.data, pollAfterMs: 3000 };
      }
      // 404 means the approval has not happened yet.
      if (response.status === 404)
        return { status: "waiting", privateState: parsed.data, pollAfterMs: 3000 };
      if (!response.ok)
        return {
          status: "error",
          error: classified("provider_unavailable", `poll returned ${response.status}`),
        };
      const token = tokenResponseSchema.safeParse(await response.json().catch(() => null));
      if (!token.success)
        return {
          status: "error",
          error: classified("invalid_response", "poll response shape changed"),
        };
      const credential: CursorCredential = {
        accessToken: token.data.accessToken,
        refreshToken: token.data.refreshToken ?? null,
      };
      return {
        status: "credentials",
        credential: { secret: credential, expiresAt: expiryOf(credential.accessToken) },
      };
    },

    cancelConnect(): Promise<void> {
      return Promise.resolve();
    },

    identity(credential: StoredCredential): Promise<Identity> {
      const secret = cursorCredentialSchema.parse(credential.secret);
      const claims = jwtClaimsSchema.safeParse(decodeJwt(secret.accessToken));
      const subject = claims.success ? claims.data.sub : undefined;
      if (!subject)
        return Promise.reject(
          new ConnectorError("invalid_response", "the access token carries no subject"),
        );
      const email = claims.success ? claims.data.email : undefined;
      return Promise.resolve({
        providerAccountId: subject,
        workspaceId: null,
        label: email ?? "Cursor",
        assurance: "strong",
      });
    },

    capabilities(): Promise<readonly Capability[]> {
      const sourceInspected = {
        interface: "private" as const,
        evidenceLevel: "source_inspected" as const,
      };
      const validated = { interface: "private" as const, evidenceLevel: "validated" as const };
      return Promise.resolve([
        { metricOrAction: "included.total_percent", availability: "available", ...validated },
        { metricOrAction: "included.auto_percent", availability: "available", ...validated },
        { metricOrAction: "included.api_percent", availability: "available", ...validated },
        { metricOrAction: "on_demand", availability: "available", ...validated },
        // Only accounts with a personal Grok Bot allowance report it; the rest show no meter.
        { metricOrAction: "grok_bot.used_percent", availability: "available", ...sourceInspected },
        {
          metricOrAction: "team_admin",
          availability: "unsupported",
          ...sourceInspected,
          reason: "admin API key connection not built yet",
        },
      ]);
    },

    async collect(credential: StoredCredential): Promise<CollectResult> {
      const secret = cursorCredentialSchema.parse(credential.secret);
      const response = await http(usageUrl, {
        method: "POST",
        headers: rpcHeaders(secret.accessToken),
        body: "{}",
      });
      throwForStatus(response, "usage");
      const usage = periodUsageSchema.safeParse(await response.json().catch(() => null));
      if (!usage.success)
        throw new ConnectorError("invalid_response", "usage response shape changed");
      const metrics = metricsFrom(usage.data);
      const failures: ClassifiedError[] = [];
      // Grok Bot is optional: a failure here is recorded but never stops the Cursor usage above.
      try {
        const grokBot = await http(grokBotUsageUrl, {
          method: "POST",
          headers: rpcHeaders(secret.accessToken),
          body: "{}",
        });
        // An account without Grok Bot answers 403 or 404: it has no meter, which is not a failure.
        if (grokBot.status === 403 || grokBot.status === 404)
          return { observedAt: now(), metrics, failures };
        throwForStatus(grokBot, "grok bot usage");
        const parsed = grokBotUsageSchema.safeParse(await grokBot.json().catch(() => null));
        if (!parsed.success)
          throw new ConnectorError("invalid_response", "grok bot usage response shape changed");
        const meter = grokBotMetric(parsed.data);
        if (meter !== null) metrics.push(meter);
      } catch (error) {
        failures.push(classifyUnknown(error));
      }
      return { observedAt: now(), metrics, failures };
    },

    async refresh(credential: StoredCredential): Promise<RefreshResult> {
      const secret = cursorCredentialSchema.parse(credential.secret);
      if (!secret.refreshToken) return { status: "not_refreshable" };
      let response: Response;
      try {
        response = await http(refreshUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret.refreshToken}`,
            "content-type": "application/json",
            "user-agent": "Headroom",
          },
          body: "{}",
        });
      } catch {
        return {
          status: "transient",
          error: classified("provider_unavailable", "refresh endpoint unreachable"),
        };
      }
      if (response.ok) {
        const token = tokenResponseSchema.safeParse(await response.json().catch(() => null));
        if (!token.success)
          return {
            status: "transient",
            error: classified("invalid_response", "refresh response shape changed"),
          };
        const next: CursorCredential = {
          accessToken: token.data.accessToken,
          refreshToken: token.data.refreshToken ?? secret.refreshToken,
        };
        return {
          status: "refreshed",
          credential: { secret: next, expiresAt: expiryOf(next.accessToken) },
        };
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
          error: classified("rate_limited", "refresh rate limited", retryAfterMs(response)),
        };
      return {
        status: "transient",
        error: classified("provider_unavailable", `refresh returned ${response.status}`),
      };
    },

    disconnect(): Promise<DisconnectResult> {
      return Promise.resolve("local_only");
    },

    classify: classifyUnknown,
  };
}

/** Cycle bounds arrive as epoch-millisecond strings (observed 2026-10-01); ISO dates are accepted too. */
function cycleDate(value: string | undefined): number | null {
  if (value !== undefined && /^\d{10,13}$/.test(value)) {
    const n = Number(value);
    return value.length === 10 ? n * 1000 : n;
  }
  return parseDate(value);
}

function metricsFrom(usage: PeriodUsage): MetricObservation[] {
  const windowStart = cycleDate(usage.billingCycleStart);
  const windowEnd = cycleDate(usage.billingCycleEnd);
  const plan = usage.planUsage;
  const percent = (key: string, value: number | null | undefined): MetricObservation => ({
    providerMetricKey: key,
    kind: "quota_percentage",
    scope: "billing_cycle",
    // The dashboard sends float noise such as 6.4750000000000005; two decimals is what Cursor shows.
    valueText: value === null || value === undefined ? null : String(Math.round(value * 100) / 100),
    unit: "percent",
    unlimited: usage.isUnlimited ?? false,
    windowStart,
    windowEnd,
    resetsAt: windowEnd,
    availability:
      usage.enabled === false
        ? "unsupported"
        : value === null || value === undefined
          ? "unknown"
          : "available",
    interface: "private",
  });
  const metrics: MetricObservation[] = [
    percent("included.total_percent", plan?.totalPercentUsed),
    percent("included.auto_percent", plan?.autoPercentUsed),
    percent("included.api_percent", plan?.apiPercentUsed),
  ];
  if (plan?.limit !== null && plan?.limit !== undefined) {
    metrics.push({
      providerMetricKey: "included.limit",
      kind: "spending_cap",
      scope: "billing_cycle",
      valueText: cents(plan.limit),
      unit: "USD",
      windowStart,
      windowEnd,
      availability: "available",
      interface: "private",
    });
  }
  const spend = usage.spendLimitUsage;
  const used = spend?.individualUsed ?? spend?.pooledUsed;
  const limit = spend?.individualLimit ?? spend?.pooledLimit;
  metrics.push({
    providerMetricKey: "on_demand.used",
    kind: "spend",
    scope: spend?.limitType ? `on_demand:${spend.limitType}` : "on_demand",
    valueText: used === null || used === undefined ? null : cents(used),
    unit: "USD",
    windowStart,
    windowEnd,
    availability: used === null || used === undefined ? "unknown" : "available",
    interface: "private",
  });
  if (limit !== null && limit !== undefined) {
    metrics.push({
      providerMetricKey: "on_demand.limit",
      kind: "spending_cap",
      scope: spend?.limitType ? `on_demand:${spend.limitType}` : "on_demand",
      valueText: cents(limit),
      unit: "USD",
      availability: "available",
      interface: "private",
    });
  }
  return metrics;
}

const week = 7 * 24 * 60 * 60_000;

/**
 * The Grok Bot allowance as a weekly percentage, or null when the account has none of its own (a pooled enterprise
 * allowance, or no included limit). The window is the reported period; it is a week when the period is missing.
 */
export function grokBotMetric(usage: GrokBotUsage): MetricObservation | null {
  if (usage.usesPooledEnterpriseAllowance === true) return null;
  if (usage.hasNonZeroIncludedLimit === false || usage.includedLimitZero === true) return null;
  const percent = usage.usagePercent;
  if (percent === undefined || !Number.isFinite(percent) || percent < 0) return null;
  const resetsAt = parseDate(usage.nextResetTimestampUtc);
  const reported = parseDate(usage.currentPeriodStart);
  const start = reported !== null && resetsAt !== null && resetsAt > reported ? reported : null;
  const seconds =
    start === null || resetsAt === null ? week / 1000 : Math.round((resetsAt - start) / 1000);
  return {
    providerMetricKey: "grok_bot.used_percent",
    kind: "quota_percentage",
    scope: `window:${seconds}s`,
    valueText: String(Math.round(Math.min(percent, 100) * 100) / 100),
    unit: "percent",
    windowStart: start ?? (resetsAt === null ? null : resetsAt - week),
    windowEnd: resetsAt,
    resetsAt,
    availability: "available",
    interface: "private",
  };
}

function cents(value: number): string {
  return (value / 100).toFixed(2);
}
