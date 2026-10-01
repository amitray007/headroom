import { randomBytes } from "node:crypto";

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
  classifyUnknown,
} from "@headroom/core";

import {
  authUrl,
  clientId,
  clientSecret,
  cloudCodeHeaders,
  cloudCodeHosts,
  knownBuckets,
  loadCodeAssistBody,
  loadCodeAssistPath,
  quotaSummaryPath,
  redirectUri,
  scopes,
  tokenUrl,
  userInfoUrl,
} from "./endpoints.ts";
import {
  antigravityCredentialSchema,
  loadCodeAssistSchema,
  quotaSummarySchema,
  tokenResponseSchema,
  userInfoSchema,
  type AntigravityCredential,
} from "./schemas.ts";

export const antigravityConnectorVersion = "0.1.0";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AntigravityConnectorOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  /** Test hook for a deterministic state value. */
  readonly randomState?: () => string;
}

const privateStateSchema = z.object({ state: z.string().min(1) });

/** Build the Google authorization URL the way the official client does: offline access, consent, state. */
export function buildAuthorizationUrl(state: string): string {
  const url = new URL(authUrl);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

/** Extract code and state from the pasted loopback URL, or accept a bare code. */
export function codeFromInput(input: SubmitInput): { code: string; state: string | null } | null {
  if (input.kind === "code") return { code: input.value.trim(), state: null };
  if (input.kind !== "redirect") return null;
  try {
    const url = new URL(input.value.trim());
    const code = url.searchParams.get("code");
    return code ? { code, state: url.searchParams.get("state") } : null;
  } catch {
    return null;
  }
}

export function createAntigravityConnector(options: AntigravityConnectorOptions = {}): Connector {
  const http: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());
  const randomState = options.randomState ?? (() => randomBytes(24).toString("base64url"));

  /** POST a JSON body to the Cloud Code path, trying each host in order until one answers. */
  async function cloudCode(
    path: string,
    accessToken: string,
    body: unknown,
    hostIndex = 0,
  ): Promise<unknown> {
    const host = cloudCodeHosts[hostIndex];
    if (!host)
      throw new ConnectorError("provider_unavailable", `${path}: every cloud code host failed`);
    let response: Response;
    try {
      response = await http(`${host}${path}`, {
        method: "POST",
        headers: cloudCodeHeaders(accessToken),
        body: JSON.stringify(body),
      });
    } catch {
      return cloudCode(path, accessToken, body, hostIndex + 1);
    }
    if (response.status === 401)
      throw new ConnectorError("authentication_required", `${path} returned 401`);
    if (response.status === 403)
      throw new ConnectorError("permission_denied", `${path} returned 403`);
    if (response.status === 429)
      throw new ConnectorError("rate_limited", `${path} returned 429`, 60_000);
    if (response.ok) return response.json().catch(() => null);
    if (response.status >= 500) return cloudCode(path, accessToken, body, hostIndex + 1);
    throw new ConnectorError("invalid_response", `${path} returned ${response.status}`);
  }

  /** Tier names and the Cloud AI Companion project the quota summary must be asked for. */
  async function loadCodeAssist(accessToken: string) {
    const load = loadCodeAssistSchema.safeParse(
      await cloudCode(loadCodeAssistPath, accessToken, loadCodeAssistBody),
    );
    if (!load.success) throw new ConnectorError("invalid_response", "loadCodeAssist shape changed");
    const project = load.data.cloudaicompanionProject;
    return {
      plan: load.data.paidTier?.name ?? load.data.currentTier?.name ?? null,
      project: typeof project === "string" ? project : (project?.id ?? null),
    };
  }

  return {
    provider: "antigravity",
    version: antigravityConnectorVersion,
    interface: "private",
    supportedMethods: ["paste_redirect"],

    beginConnect(begin: BeginConnectOptions): Promise<ConnectProgress> {
      const state = randomState();
      return Promise.resolve({
        status: "next_step",
        nextStep: {
          kind: "paste_redirect",
          url: buildAuthorizationUrl(state),
          expiresAt: begin.expiresAt,
          accepts: "url_or_code",
        },
        privateState: { state },
      });
    },

    async submitInput(privateState: unknown, input: SubmitInput): Promise<ConnectProgress> {
      const parsed = privateStateSchema.safeParse(privateState);
      const pasted = codeFromInput(input);
      if (!parsed.success || !pasted) {
        return {
          status: "error",
          error: classified("invalid_response", "expected the redirected URL or its code"),
        };
      }
      if (pasted.state !== null && pasted.state !== parsed.data.state) {
        return {
          status: "error",
          error: classified("approval_denied", "the pasted URL belongs to a different sign-in"),
        };
      }
      let response: Response;
      try {
        response = await http(tokenUrl, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: new URLSearchParams({
            code: pasted.code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });
      } catch {
        return {
          status: "error",
          error: classified("provider_unavailable", "token endpoint unreachable"),
        };
      }
      if (!response.ok) {
        const category =
          response.status === 400 || response.status === 401
            ? "approval_denied"
            : "provider_unavailable";
        return {
          status: "error",
          error: classified(category, `code exchange returned ${response.status}`),
        };
      }
      const token = tokenResponseSchema.safeParse(await response.json().catch(() => null));
      if (!token.success)
        return {
          status: "error",
          error: classified("invalid_response", "token response shape changed"),
        };
      const credential: AntigravityCredential = {
        accessToken: token.data.access_token,
        refreshToken: token.data.refresh_token ?? null,
        email: null,
        subject: null,
      };
      return {
        status: "credentials",
        credential: {
          secret: credential,
          expiresAt:
            token.data.expires_in === undefined ? null : now() + token.data.expires_in * 1000,
        },
      };
    },

    pollConnect(): Promise<ConnectProgress> {
      return Promise.resolve({
        status: "error",
        error: classified("internal_error", "pasted redirect flows do not poll"),
      });
    },

    cancelConnect(): Promise<void> {
      return Promise.resolve();
    },

    async identity(credential: StoredCredential): Promise<Identity> {
      const secret = antigravityCredentialSchema.parse(credential.secret);
      const response = await http(userInfoUrl, {
        headers: { authorization: `Bearer ${secret.accessToken}`, accept: "application/json" },
      });
      if (response.status === 401)
        throw new ConnectorError("authentication_required", "userinfo returned 401");
      if (!response.ok)
        throw new ConnectorError("provider_unavailable", `userinfo returned ${response.status}`);
      const info = userInfoSchema.safeParse(await response.json().catch(() => null));
      if (!info.success) throw new ConnectorError("invalid_response", "userinfo shape changed");
      let plan: string | null = null;
      try {
        plan = (await loadCodeAssist(secret.accessToken)).plan;
      } catch {
        plan = null;
      }
      return {
        providerAccountId: info.data.id,
        workspaceId: null,
        label: [info.data.email ?? "Antigravity", plan ? `(${plan})` : ""]
          .filter(Boolean)
          .join(" "),
        assurance: "strong",
      };
    },

    capabilities(): Promise<readonly Capability[]> {
      const capabilities: Capability[] = Object.keys(knownBuckets).map((bucket) => ({
        metricOrAction: `quota.${bucket}`,
        availability: "available",
        interface: "private",
        evidenceLevel: bucket.endsWith("-weekly") ? "validated" : "source_inspected",
        reason: "present when the account's tier reports this window",
      }));
      capabilities.push({
        metricOrAction: "credits",
        availability: "unknown",
        interface: "private",
        evidenceLevel: "source_inspected",
        reason: "no validated source",
      });
      return Promise.resolve(capabilities);
    },

    async collect(credential: StoredCredential): Promise<CollectResult> {
      const secret = antigravityCredentialSchema.parse(credential.secret);
      const { project } = await loadCodeAssist(secret.accessToken);
      if (project === null)
        throw new ConnectorError("permission_denied", "loadCodeAssist returned no project");
      const summary = quotaSummarySchema.safeParse(
        await cloudCode(quotaSummaryPath, secret.accessToken, { project }),
      );
      if (!summary.success)
        throw new ConnectorError("invalid_response", "quota summary shape changed");
      const groups =
        ("groups" in summary.data && summary.data.groups) || summary.data.response?.groups || [];
      const observedAt = now();
      const metrics: MetricObservation[] = [];
      const seen = new Set<string>();
      for (const group of groups) {
        for (const bucket of group.buckets ?? []) {
          const id = bucket.bucketId;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const known = knownBuckets[id];
          const remaining = bucket.remainingFraction;
          metrics.push({
            providerMetricKey: `quota.${id}`,
            kind: "quota_percentage",
            scope: known?.scope ?? "window",
            // Provider reports remaining fraction; Headroom stores used percent like every other connector.
            valueText: remaining === undefined ? null : ((1 - remaining) * 100).toFixed(2),
            unit: "percent",
            resetsAt: parseDate(bucket.resetTime),
            availability: remaining === undefined ? "unknown" : "available",
            interface: "private",
          });
        }
      }
      // Buckets the tier does not report are not missing data: the free tier of 2026-10-01 carried
      // only the weekly buckets. Known ids only supply scope and label.
      return { observedAt, metrics, failures: [] };
    },

    async refresh(credential: StoredCredential): Promise<RefreshResult> {
      const secret = antigravityCredentialSchema.parse(credential.secret);
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
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: secret.refreshToken,
            grant_type: "refresh_token",
          }),
        });
      } catch {
        return {
          status: "transient",
          error: classified("provider_unavailable", "token endpoint unreachable"),
        };
      }
      if (response.ok) {
        const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null));
        if (!parsed.success)
          return {
            status: "transient",
            error: classified("invalid_response", "refresh response shape changed"),
          };
        const next: AntigravityCredential = {
          ...secret,
          accessToken: parsed.data.access_token,
          refreshToken: parsed.data.refresh_token ?? secret.refreshToken,
        };
        return {
          status: "refreshed",
          credential: {
            secret: next,
            expiresAt:
              parsed.data.expires_in === undefined ? null : now() + parsed.data.expires_in * 1000,
          },
        };
      }
      if (response.status === 400 || response.status === 401) {
        // Google answers invalid_grant when the user revoked access or the refresh token expired.
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

    async disconnect(credential: StoredCredential): Promise<DisconnectResult> {
      // Google documents token revocation; best effort, the local row is deleted regardless.
      const secret = antigravityCredentialSchema.parse(credential.secret);
      try {
        const response = await http("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: secret.refreshToken ?? secret.accessToken }),
        });
        return response.ok ? "revoked" : "failed";
      } catch {
        return "failed";
      }
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

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
