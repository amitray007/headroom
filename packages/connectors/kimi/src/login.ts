import {
  type Connector,
  ConnectorError,
  type ConnectProgress,
  type FetchLike,
  type StoredCredential,
  classified,
  classifyUnknown,
  throwForStatus,
} from "@headroom/core";
import { clientId, deviceHeaders, devicePath, regions, tokenPath } from "./endpoints.ts";
import {
  deviceAttemptSchema,
  deviceResponseSchema,
  oauthCredentialSchema,
  oauthErrorSchema,
  regionAttemptSchema,
  regionSchema,
  tokenResponseSchema,
} from "./schemas.ts";

/** All private state is stored by the application in the encrypted attempt or credential. */
export function createKimiLogin(
  http: FetchLike,
  now: () => number,
  version: string,
): Pick<Connector, "beginConnect" | "submitInput" | "pollConnect" | "cancelConnect" | "refresh"> {
  async function post(
    region: keyof typeof regions,
    deviceId: string,
    path: string,
    values: Record<string, string>,
  ): Promise<Response> {
    try {
      return await http(`${regions[region].oauthHost}${path}`, {
        method: "POST",
        headers: {
          ...deviceHeaders(deviceId, version),
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ client_id: clientId, ...values }).toString(),
        redirect: "error",
      });
    } catch {
      throw new ConnectorError("provider_unavailable", "Kimi sign-in service could not be reached");
    }
  }

  async function authorize(
    region: keyof typeof regions,
    deviceId: string,
    expiresAt: number,
  ): Promise<ConnectProgress> {
    if (expiresAt <= now()) return expired();
    try {
      const response = await post(region, deviceId, devicePath, {});
      throwForStatus(response, "Kimi device authorization");
      const parsed = deviceResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success)
        throw new ConnectorError(
          "invalid_response",
          "Kimi device authorization response shape changed",
        );
      const data = parsed.data;
      const verification = new URL(data.verification_uri_complete);
      if (
        ![regions[region].oauthHost, regions[region].webBaseUrl].some(
          (origin) => verification.origin === origin,
        ) ||
        verification.username !== "" ||
        verification.password !== ""
      )
        throw new ConnectorError("invalid_response", "Kimi returned an unexpected approval host");
      const deadline = Math.min(
        expiresAt,
        data.expires_in === null || data.expires_in === undefined
          ? expiresAt
          : now() + data.expires_in * 1000,
      );
      const intervalMs = Math.max(1000, data.interval * 1000);
      return {
        status: "next_step",
        nextStep: {
          kind: "device_code",
          verificationUrl: verification.href,
          userCode: data.user_code,
          expiresAt: deadline,
        },
        privateState: {
          stage: "device",
          region,
          deviceId,
          deviceCode: data.device_code,
          expiresAt: deadline,
          intervalMs,
        },
        pollAfterMs: intervalMs,
      };
    } catch (error) {
      return { status: "error", error: classifyUnknown(error) };
    }
  }

  return {
    async beginConnect(begin) {
      if (begin.method !== "device_code")
        return {
          status: "error",
          error: classified("unsupported_metric", "Use Kimi browser sign-in"),
        };
      const deviceId = crypto.randomUUID();
      const existingRegion = regionSchema.safeParse(
        begin.existingIdentity?.providerAccountId.split(":")[0],
      );
      if (existingRegion.success) return authorize(existingRegion.data, deviceId, begin.expiresAt);
      return {
        status: "next_step",
        nextStep: {
          kind: "select_account",
          label: "Account region",
          hint: "Choose your Kimi account’s region, then approve Headroom in your browser.",
          options: Object.entries(regions).map(([id, region]) => ({ id, label: region.label })),
        },
        privateState: { stage: "region", expiresAt: begin.expiresAt, deviceId },
      };
    },
    async submitInput(state, input) {
      const parsed = regionAttemptSchema.safeParse(state);
      const region = regionSchema.safeParse(input.kind === "selection" ? input.id : null);
      if (!parsed.success || !region.success)
        return {
          status: "error",
          error: classified("invalid_response", "Choose the Kimi account region"),
        };
      return authorize(region.data, parsed.data.deviceId, parsed.data.expiresAt);
    },
    async pollConnect(state) {
      const parsed = deviceAttemptSchema.safeParse(state);
      if (!parsed.success)
        return {
          status: "error",
          error: classified("internal_error", "Kimi sign-in attempt is missing"),
        };
      const attempt = parsed.data;
      if (attempt.expiresAt <= now()) return expired();
      const waiting = (intervalMs = attempt.intervalMs): ConnectProgress => ({
        status: "waiting",
        privateState: { ...attempt, intervalMs },
        pollAfterMs: intervalMs,
      });
      let response: Response;
      try {
        response = await post(attempt.region, attempt.deviceId, tokenPath, {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: attempt.deviceCode,
        });
      } catch {
        return waiting(Math.max(attempt.intervalMs, 5000));
      }
      if (response.status === 429 || response.status >= 500) {
        try {
          throwForStatus(response, "Kimi approval polling");
        } catch (error) {
          const retry = classifyUnknown(error).retryAfterMs;
          return waiting(Math.max(attempt.intervalMs, Math.min(retry ?? 5000, 300_000)));
        }
      }
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const token = tokenResponseSchema.safeParse(body);
        if (!token.success)
          return {
            status: "error",
            error: classified("invalid_response", "Kimi token response shape changed"),
          };
        return {
          status: "credentials",
          credential: stored(token.data, attempt.region, attempt.deviceId, now()),
        };
      }
      const error = oauthErrorSchema.safeParse(body);
      switch (error.success ? error.data.error : null) {
        case "authorization_pending":
          return waiting();
        case "slow_down":
          return waiting(Math.min(attempt.intervalMs + 5000, 300_000));
        case "expired_token":
          return expired();
        case "access_denied":
          return {
            status: "error",
            error: classified("approval_denied", "Kimi sign-in was declined"),
          };
        case null:
        default:
          return {
            status: "error",
            error: classified("invalid_response", "Kimi approval response was not recognized"),
          };
      }
    },
    cancelConnect: () => Promise.resolve(),
    async refresh(credential) {
      const parsed = oauthCredentialSchema.safeParse(credential.secret);
      if (!parsed.success) return { status: "not_refreshable" };
      const secret = parsed.data;
      try {
        const response = await post(secret.region, secret.deviceId, tokenPath, {
          grant_type: "refresh_token",
          refresh_token: secret.refreshToken,
        });
        const body: unknown = await response.json().catch(() => null);
        const error = oauthErrorSchema.safeParse(body);
        if (
          response.status === 401 ||
          response.status === 403 ||
          (response.status === 400 &&
            error.success &&
            ["invalid_grant", "invalid_token", "access_denied"].includes(error.data.error))
        )
          return {
            status: "rejected",
            error: classified(
              "authentication_required",
              "Kimi session expired or was revoked; reconnect through browser sign-in",
            ),
          };
        throwForStatus(response, "Kimi session refresh");
        const token = tokenResponseSchema.safeParse(body);
        if (!token.success)
          throw new ConnectorError(
            "invalid_response",
            "Kimi refreshed token response shape changed",
          );
        return {
          status: "refreshed",
          credential: stored(token.data, secret.region, secret.deviceId, now()),
        };
      } catch (error) {
        return { status: "transient", error: classifyUnknown(error) };
      }
    },
  };
}

function expired(): ConnectProgress {
  return {
    status: "error",
    error: classified("approval_expired", "Kimi sign-in approval expired"),
  };
}
function stored(
  token: { access_token: string; refresh_token: string; expires_in: number },
  region: keyof typeof regions,
  deviceId: string,
  now: number,
): StoredCredential {
  return {
    secret: {
      kind: "oauth",
      region,
      deviceId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
    },
    expiresAt: Math.round(now + token.expires_in * 1000),
  };
}
