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
  classifyUnknown,
} from "@headroom/core";

import { loginUrl, pollUrl, refreshUrl, rpcHeaders, usageUrl } from "./endpoints.ts";
import {
  cursorCredentialSchema,
  jwtClaimsSchema,
  periodUsageSchema,
  tokenResponseSchema,
  type CursorCredential,
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
  const http: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
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
      return Promise.resolve([
        { metricOrAction: "included.total_percent", availability: "available", ...sourceInspected },
        { metricOrAction: "included.auto_percent", availability: "available", ...sourceInspected },
        { metricOrAction: "included.api_percent", availability: "available", ...sourceInspected },
        { metricOrAction: "on_demand", availability: "available", ...sourceInspected },
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
      await throwForStatus(response, "usage");
      const usage = periodUsageSchema.safeParse(await response.json().catch(() => null));
      if (!usage.success)
        throw new ConnectorError("invalid_response", "usage response shape changed");
      return { observedAt: now(), metrics: metricsFrom(usage.data), failures: [] };
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
          error: classified("rate_limited", "refresh rate limited", 60_000),
        };
      return {
        status: "transient",
        error: classified("provider_unavailable", `refresh returned ${response.status}`),
      };
    },

    disconnect(): Promise<DisconnectResult> {
      return Promise.resolve("local_only");
    },

    classify,
  };
}

function metricsFrom(usage: PeriodUsage): MetricObservation[] {
  const windowStart = parseDate(usage.billingCycleStart);
  const windowEnd = parseDate(usage.billingCycleEnd);
  const plan = usage.planUsage;
  const percent = (key: string, value: number | null | undefined): MetricObservation => ({
    providerMetricKey: key,
    kind: "quota_percentage",
    scope: "billing_cycle",
    valueText: value === null || value === undefined ? null : String(value),
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

function cents(value: number): string {
  return (value / 100).toFixed(2);
}
