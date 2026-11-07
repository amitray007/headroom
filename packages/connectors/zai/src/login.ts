import {
  type Connector,
  ConnectorError,
  type ConnectProgress,
  type FetchLike,
  type StoredCredential,
  classified,
  classifyUnknown,
} from "@headroom/core";
import {
  approvalUrl,
  businessLoginUrl,
  callbackUrl,
  initUrl,
  jsonHeaders,
  pollBaseUrl,
  publicClientId,
  apiHeaders,
} from "./endpoints.ts";
import { businessData, customerIdentity, readJson } from "./http.ts";
import {
  attemptSchema,
  businessTokenSchema,
  initSchema,
  jwtExpirySchema,
  pollSchema,
  sessionSchema,
} from "./schemas.ts";

export function createZaiLogin(
  http: FetchLike,
  now: () => number,
): Pick<Connector, "beginConnect" | "submitInput" | "pollConnect" | "cancelConnect" | "refresh"> {
  async function exchange(
    oauthAccessToken: string,
    label: string,
    expectedAccountId?: string,
    zcodeToken?: string,
  ): Promise<StoredCredential> {
    const oauthExpiry = jwtExpiry(oauthAccessToken);
    if (oauthExpiry !== null && oauthExpiry <= now())
      throw new ConnectorError(
        "authentication_required",
        "Z.ai sign-in expired; reconnect in your browser",
      );
    const body = await readJson(http, businessLoginUrl, "Z.ai session exchange", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ token: oauthAccessToken }),
    });
    const parsed = businessTokenSchema.safeParse(businessData(body));
    if (!parsed.success)
      throw new ConnectorError("invalid_response", "Z.ai session exchange response shape changed");
    const accessToken = parsed.data.access_token ?? parsed.data.accessToken;
    if (accessToken === undefined)
      throw new ConnectorError("invalid_response", "Z.ai session token is missing");
    const accountId = await customerIdentity(http, accessToken);
    if (expectedAccountId !== undefined && accountId !== expectedAccountId)
      throw new ConnectorError(
        "identity_mismatch",
        "Z.ai renewed session belongs to another account",
      );
    const deadlines = [
      jwtExpiry(accessToken),
      parsed.data.expires_in === null || parsed.data.expires_in === undefined
        ? null
        : Math.round(now() + parsed.data.expires_in * 1000),
    ].filter((value): value is number => value !== null);
    const expiresAt = deadlines.length ? Math.min(...deadlines) : null;
    if (expiresAt !== null && expiresAt <= now())
      throw new ConnectorError(
        "authentication_required",
        "Z.ai returned an expired session; reconnect in your browser",
      );
    return {
      secret: {
        kind: "oauth",
        oauthAccessToken,
        accessToken,
        accountId,
        label,
        ...(zcodeToken === undefined ? {} : { zcodeToken }),
      },
      expiresAt,
    };
  }
  return {
    async beginConnect(begin) {
      if (begin.method !== "approval_poll")
        return {
          status: "error",
          error: classified("unsupported_metric", "Use Z.ai browser sign-in"),
        };
      if (begin.expiresAt <= now()) return expired();
      const pollToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
      try {
        const body = await readJson(http, initUrl, "Z.ai browser sign-in", {
          method: "POST",
          headers: apiHeaders(pollToken, true),
          body: JSON.stringify({ provider: "zai" }),
        });
        const parsed = initSchema.safeParse(body);
        if (!parsed.success)
          throw new ConnectorError("invalid_response", "Z.ai sign-in response shape changed");
        const data = parsed.data.data;
        const verification = new URL(data.authorize_url);
        const callback = verification.searchParams.get("redirect_uri");
        if (
          verification.origin + verification.pathname !== approvalUrl ||
          verification.username ||
          verification.password ||
          verification.hash ||
          verification.searchParams.get("client_id") !== publicClientId ||
          verification.searchParams.get("response_type") !== "code" ||
          !verification.searchParams.get("state") ||
          callback !== callbackUrl ||
          verification.href.includes(pollToken) ||
          (data.poll_token !== undefined && data.poll_token !== pollToken)
        )
          throw new ConnectorError(
            "invalid_response",
            "Z.ai returned an unexpected approval address",
          );
        const expiresAt = Math.min(begin.expiresAt, Math.round(data.expires_at * 1000));
        const intervalMs = Math.round(data.poll_interval_sec * 1000);
        if (
          expiresAt <= now() ||
          intervalMs < 1000 ||
          intervalMs >= expiresAt - now() ||
          intervalMs > 300000
        )
          throw new ConnectorError(
            "invalid_response",
            "Z.ai returned an invalid approval deadline",
          );
        return {
          status: "next_step",
          nextStep: { kind: "open_url", url: verification.href, expiresAt },
          privateState: { flowId: data.flow_id, pollToken, expiresAt, intervalMs },
          pollAfterMs: intervalMs,
        };
      } catch (error) {
        return { status: "error", error: classifyUnknown(error) };
      }
    },
    submitInput: () =>
      Promise.resolve({
        status: "error",
        error: classified(
          "unsupported_metric",
          "Approve Z.ai sign-in in your browser; no API key is needed",
        ),
      }),
    async pollConnect(state) {
      const parsed = attemptSchema.safeParse(state);
      if (!parsed.success)
        return {
          status: "error",
          error: classified("internal_error", "Z.ai sign-in attempt is missing"),
        };
      const attempt = parsed.data;
      if (attempt.expiresAt <= now()) return expired();
      const waiting = (delay = attempt.intervalMs): ConnectProgress => {
        const intervalMs = Math.min(300000, delay);
        return {
          status: "waiting",
          privateState: { ...attempt, intervalMs },
          pollAfterMs: intervalMs,
        };
      };
      try {
        const body = await readJson(
          http,
          pollBaseUrl + encodeURIComponent(attempt.flowId),
          "Z.ai approval",
          { method: "GET", headers: apiHeaders(attempt.pollToken, true) },
        );
        const polled = pollSchema.safeParse(body);
        if (!polled.success)
          throw new ConnectorError("invalid_response", "Z.ai approval response shape changed");
        const data = polled.data.data;
        if (data.status === "pending") return waiting();
        if (data.status === "failed")
          return {
            status: "error",
            error: classified("approval_denied", "Z.ai sign-in was not approved"),
          };
        const credential = await exchange(
          data.zai.access_token,
          data.user.name || data.user.email || "Z.ai Coding Plan",
          undefined,
          data.token,
        );
        return { status: "credentials", credential };
      } catch (error) {
        const failure = classifyUnknown(error);
        if (failure.class === "transient")
          return waiting(Math.max(attempt.intervalMs, failure.retryAfterMs ?? 5000));
        return { status: "error", error: failure };
      }
    },
    cancelConnect: () => Promise.resolve(),
    async refresh(credential) {
      const parsed = sessionSchema.safeParse(credential.secret);
      if (!parsed.success) return { status: "not_refreshable" };
      const secret = parsed.data;
      try {
        return {
          status: "refreshed",
          credential: await exchange(
            secret.oauthAccessToken,
            secret.label,
            secret.accountId,
            secret.zcodeToken,
          ),
        };
      } catch (error) {
        const failure = classifyUnknown(error);
        return {
          status: failure.class === "definitive" ? "rejected" : "transient",
          error: failure,
        };
      }
    },
  };
}
function expired(): ConnectProgress {
  return { status: "error", error: classified("approval_expired", "Z.ai browser sign-in expired") };
}
function jwtExpiry(token: string): number | null {
  try {
    const parsed = jwtExpirySchema.safeParse(
      JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")),
    );
    return parsed.success ? Math.round(parsed.data.exp * 1000) : null;
  } catch {
    return null;
  }
}
