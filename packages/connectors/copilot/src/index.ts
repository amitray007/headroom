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
  type MetricObservation,
  type RefreshResult,
  type StoredCredential,
  type SubmitInput,
  classified,
  classifyUnknown,
  parseDate,
  throwForStatus,
  timeoutFetch,
} from "@headroom/core";

import {
  accessTokenUrl,
  clientId,
  deviceCodeUrl,
  githubHeaders,
  scope,
  usageHeaders,
  usageUrl,
  userUrl,
} from "./endpoints.ts";
import {
  accessTokenResponseSchema,
  appsFileSchema,
  copilotCredentialSchema,
  deviceCodeResponseSchema,
  usageResponseSchema,
  userSchema,
  type Snapshot,
  type UsageResponse,
} from "./schemas.ts";

export const copilotConnectorVersion = "0.1.0";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CopilotConnectorOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}

const privateStateSchema = z.object({ deviceCode: z.string().min(1), intervalMs: z.number() });

/** Accept a pasted `apps.json`; the first entry with a token wins. */
export function credentialFromAppsFile(contents: string): StoredCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new ConnectorError("invalid_response", "the pasted file is not JSON");
  }
  const file = appsFileSchema.safeParse(parsed);
  const entry = file.success ? Object.values(file.data)[0] : undefined;
  if (!entry)
    throw new ConnectorError(
      "invalid_response",
      "the file is not a Copilot apps.json with an oauth_token",
    );
  return { secret: { token: entry.oauth_token }, expiresAt: null };
}

export function createCopilotConnector(options: CopilotConnectorOptions = {}): Connector {
  const http: FetchLike = options.fetch ?? timeoutFetch();
  const now = options.now ?? (() => Date.now());

  return {
    provider: "copilot",
    version: copilotConnectorVersion,
    interface: "private",
    supportedMethods: ["device_code", "import"],

    async beginConnect(begin: BeginConnectOptions): Promise<ConnectProgress> {
      if (begin.method === "import") {
        return {
          status: "next_step",
          nextStep: {
            kind: "paste_file",
            expectedFileName: "apps.json",
            hint: "From ~/.config/github-copilot/ after signing in to Copilot in an editor. Headroom encrypts it and never writes it back.",
          },
          privateState: {},
        };
      }
      let response: Response;
      try {
        response = await http(deviceCodeUrl, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ client_id: clientId, scope }),
        });
      } catch {
        return {
          status: "error",
          error: classified("provider_unavailable", "GitHub device endpoint unreachable"),
        };
      }
      if (!response.ok)
        return {
          status: "error",
          error: classified(
            "provider_unavailable",
            `device code request returned ${response.status}`,
          ),
        };
      const device = deviceCodeResponseSchema.safeParse(await response.json().catch(() => null));
      if (!device.success)
        return {
          status: "error",
          error: classified("invalid_response", "device code response shape changed"),
        };
      return {
        status: "next_step",
        nextStep: {
          kind: "device_code",
          verificationUrl: device.data.verification_uri,
          userCode: device.data.user_code,
          expiresAt: Math.min(begin.expiresAt, now() + device.data.expires_in * 1000),
        },
        privateState: {
          deviceCode: device.data.device_code,
          intervalMs: (device.data.interval ?? 5) * 1000,
        },
      };
    },

    submitInput(_privateState: unknown, input: SubmitInput): Promise<ConnectProgress> {
      if (input.kind !== "file") {
        return Promise.resolve({
          status: "error",
          error: classified("invalid_response", "expected a pasted apps.json"),
        });
      }
      try {
        return Promise.resolve({
          status: "credentials",
          credential: credentialFromAppsFile(input.contents),
        });
      } catch (error) {
        return Promise.resolve({ status: "error", error: classifyUnknown(error) });
      }
    },

    async pollConnect(privateState: unknown): Promise<ConnectProgress> {
      const parsed = privateStateSchema.safeParse(privateState);
      if (!parsed.success)
        return { status: "error", error: classified("internal_error", "attempt state missing") };
      let response: Response;
      try {
        response = await http(accessTokenUrl, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            device_code: parsed.data.deviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        });
      } catch {
        return {
          status: "waiting",
          privateState: parsed.data,
          pollAfterMs: parsed.data.intervalMs,
        };
      }
      const body = accessTokenResponseSchema.safeParse(await response.json().catch(() => null));
      if (!body.success)
        return {
          status: "error",
          error: classified("invalid_response", "token response shape changed"),
        };
      if ("access_token" in body.data) {
        return {
          status: "credentials",
          credential: { secret: { token: body.data.access_token }, expiresAt: null },
        };
      }
      switch (body.data.error) {
        case "authorization_pending":
          return {
            status: "waiting",
            privateState: parsed.data,
            pollAfterMs: parsed.data.intervalMs,
          };
        case "slow_down":
          return {
            status: "waiting",
            privateState: { ...parsed.data, intervalMs: parsed.data.intervalMs + 5000 },
            pollAfterMs: parsed.data.intervalMs + 5000,
          };
        case "expired_token":
          return {
            status: "error",
            error: classified("approval_expired", "the device code expired"),
          };
        case "access_denied":
          return {
            status: "error",
            error: classified("approval_denied", "the sign-in was denied"),
          };
        default:
          return {
            status: "error",
            // The error code is provider text; the owner sees fixed wording and the HTTP status only.
            error: classified(
              "provider_unavailable",
              `GitHub refused the sign-in (HTTP ${response.status})`,
            ),
          };
      }
    },

    cancelConnect(): Promise<void> {
      return Promise.resolve();
    },

    async identity(credential: StoredCredential): Promise<Identity> {
      const { token } = copilotCredentialSchema.parse(credential.secret);
      const response = await http(userUrl, { headers: githubHeaders(token) });
      throwForStatus(response, "user", githubStatus);
      const user = userSchema.safeParse(await response.json().catch(() => null));
      if (!user.success)
        throw new ConnectorError("invalid_response", "user response shape changed");
      return {
        providerAccountId: String(user.data.id),
        workspaceId: null,
        label: `${user.data.login} (Copilot)`,
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
        { metricOrAction: "credits", availability: "available", ...validated },
        { metricOrAction: "extra_usage", availability: "available", ...validated },
        { metricOrAction: "chat", availability: "available", ...validated },
        { metricOrAction: "completions", availability: "available", ...validated },
        {
          metricOrAction: "organization_billing",
          availability: "unsupported",
          ...sourceInspected,
          reason: "separate organization connection, not built yet",
        },
      ]);
    },

    async collect(credential: StoredCredential): Promise<CollectResult> {
      const { token } = copilotCredentialSchema.parse(credential.secret);
      const response = await http(usageUrl, { headers: usageHeaders(token) });
      throwForStatus(response, "usage", githubStatus);
      const usage = usageResponseSchema.safeParse(await response.json().catch(() => null));
      if (!usage.success)
        throw new ConnectorError("invalid_response", "usage response shape changed");
      return { observedAt: now(), metrics: metricsFrom(usage.data), failures: [] };
    },

    refresh(): Promise<RefreshResult> {
      // OAuth App tokens from the device flow carry no refresh token and do not expire.
      return Promise.resolve({ status: "not_refreshable" });
    },

    disconnect(): Promise<DisconnectResult> {
      // Revoking an OAuth App token needs the app's client secret, which Headroom does not have.
      return Promise.resolve("local_only");
    },

    classify: classifyUnknown,
  };
}

/** Every plan bills by AI credits since June 2026; `premium_interactions` is that pool. */
function metricsFrom(usage: UsageResponse): MetricObservation[] {
  const metrics: MetricObservation[] = [];
  const resetsAt = parseDate(usage.quota_reset_date);
  const snapshots = usage.quota_snapshots;
  const premium = snapshots?.premium_interactions;
  const hasPool =
    premium !== undefined && (premium.entitlement ?? 0) > 0 && premium.unlimited !== true;
  metrics.push({
    providerMetricKey: "credits.used_percent",
    kind: "quota_percentage",
    scope: "month",
    valueText:
      hasPool && premium.percent_remaining !== undefined
        ? String(round(100 - premium.percent_remaining))
        : null,
    unit: "percent",
    unlimited: premium?.unlimited ?? false,
    resetsAt,
    availability:
      premium === undefined
        ? "unknown"
        : hasPool
          ? premium.percent_remaining === undefined
            ? "unknown"
            : "available"
          : premium.unlimited
            ? "available"
            : "unsupported",
    interface: "private",
  });
  if (premium?.credits_used !== undefined) {
    metrics.push({
      providerMetricKey: "credits.used_count",
      kind: "absolute_quota",
      scope: "month",
      valueText: String(premium.credits_used),
      unit: "credits",
      resetsAt,
      availability: "available",
      interface: "private",
    });
  }
  metrics.push({
    providerMetricKey: "extra_usage.count",
    kind: "absolute_quota",
    scope: "month",
    valueText:
      hasPool && premium.overage_count !== undefined ? String(premium.overage_count) : null,
    unit: "credits",
    resetsAt,
    availability: hasPool
      ? premium.overage_count === undefined
        ? "unknown"
        : "available"
      : "unsupported",
    interface: "private",
  });
  for (const key of ["chat", "completions"] as const) {
    metrics.push(countMetric(key, snapshots?.[key], resetsAt));
  }
  return metrics;
}

function countMetric(
  key: string,
  snapshot: Snapshot | undefined,
  resetsAt: number | null,
): MetricObservation {
  const unlimited = snapshot?.unlimited === true || snapshot?.entitlement === -1;
  const used =
    snapshot?.entitlement !== undefined && snapshot.remaining !== undefined && !unlimited
      ? snapshot.entitlement - snapshot.remaining
      : null;
  return {
    providerMetricKey: `${key}.used`,
    kind: "absolute_quota",
    scope: "month",
    valueText: used === null ? null : String(used),
    unit: "requests",
    unlimited,
    resetsAt,
    availability:
      snapshot === undefined ? "unknown" : unlimited || used !== null ? "available" : "unknown",
    interface: "private",
  };
}

/**
 * GitHub's secondary rate limit arrives as a 403. It counts only when GitHub says so: no requests
 * remaining, or a Retry-After header actually present. Any other 403 is a missing permission.
 */
const githubStatus = {
  forbiddenIsRateLimit: (response: Response) =>
    response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"),
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
