import {
  type Capability,
  type ClassifiedError,
  type CollectResult,
  type Connector,
  ConnectorError,
  type FetchLike,
  type MetricObservation,
  type StoredCredential,
  classified,
  classifyUnknown,
  throwForStatus,
  timeoutFetch,
} from "@headroom/core";
import { apiHeaders, deviceHeaders, regions } from "./endpoints.ts";
import { createKimiLogin } from "./login.ts";
import {
  credentialSchema,
  legacyCountSchema,
  legacyWindowSchema,
  objectSchema,
  profileSchema,
  ratioSchema,
  resetSchema,
} from "./schemas.ts";

export const kimiConnectorVersion = "0.4.0";
interface KimiConnectorOptions {
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}
const windows = [
  { field: "limit_5h", key: "quota.five_hour", scope: "window:18000s" },
  { field: "limit_7d", key: "quota.weekly", scope: "window:604800s" },
] as const;
type QuotaWindow = (typeof windows)[number];

export function createKimiConnector(options: KimiConnectorOptions = {}): Connector {
  const http = timeoutFetch(options.fetch);
  const now = options.now ?? Date.now;
  async function read(credential: StoredCredential, path: "me" | "usages"): Promise<unknown> {
    const secret = credentialSchema.safeParse(credential.secret);
    if (!secret.success)
      throw new ConnectorError(
        "authentication_required",
        "the stored Kimi session or region is invalid",
      );
    try {
      const response = await http(`${regions[secret.data.region].baseUrl}/${path}`, {
        method: "GET",
        headers:
          "apiKey" in secret.data
            ? apiHeaders(secret.data.apiKey)
            : apiHeaders(
                secret.data.accessToken,
                deviceHeaders(secret.data.deviceId, kimiConnectorVersion),
              ),
        // No cross-region fallback or redirect may forward the key to another host.
        redirect: "error",
      });
      throwForStatus(response, `Kimi Code ${path}`);
      return await response.json().catch(() => {
        throw new ConnectorError("invalid_response", `Kimi Code ${path} returned unreadable JSON`);
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError("provider_unavailable", `Kimi Code ${path} request failed`);
    }
  }
  async function readProfile(credential: StoredCredential) {
    const profile = profileSchema.safeParse(await read(credential, "me"));
    if (!profile.success)
      throw new ConnectorError("invalid_response", "Kimi Code profile response shape changed");
    return profile.data;
  }
  return {
    provider: "kimi",
    version: kimiConnectorVersion,
    interface: "private",
    supportedMethods: ["device_code"],
    ...createKimiLogin(http, now, kimiConnectorVersion),
    async identity(credential) {
      const profile = await readProfile(credential);
      const secret = credentialSchema.parse(credential.secret);
      const { region } = secret;
      const label = profile.email || profile.nickname || "Kimi Code";
      const plan = profile.user_level_name;
      return {
        providerAccountId: `${region}:${profile.user_id}`,
        workspaceId: null,
        label: plan ? `${label} (${plan})` : label,
        assurance: "strong",
      };
    },
    capabilities(): Promise<readonly Capability[]> {
      return Promise.resolve(
        windows.map((window) => ({
          metricOrAction: window.key,
          availability: "unknown",
          interface: "private",
          evidenceLevel: "source_inspected",
          reason:
            "Only windows returned by this account are read; live quota access is unvalidated",
        })),
      );
    },
    async collect(credential, identity): Promise<CollectResult> {
      const secret = credentialSchema.parse(credential.secret);
      if ("accessToken" in secret) {
        const profile = await readProfile(credential);
        if (`${secret.region}:${profile.user_id}` !== identity.providerAccountId)
          throw new ConnectorError(
            "identity_mismatch",
            "Kimi session belongs to a different account",
          );
      }
      const payload = objectSchema.safeParse(await read(credential, "usages"));
      if (!payload.success)
        throw new ConnectorError("invalid_response", "Kimi Code usage response shape changed");
      const failures: ClassifiedError[] = [];
      const metrics =
        payload.data["usages"] === undefined
          ? legacyMetrics(payload.data, failures)
          : currentMetrics(payload.data["usages"], failures);
      if (metrics.length === 0)
        failures.push(
          classified("invalid_response", "Kimi Code returned no recognized quota windows"),
        );
      return { observedAt: now(), metrics, failures };
    },
    disconnect: () => Promise.resolve("local_only"),
    classify: classifyUnknown,
  };
}

function currentMetrics(raw: unknown, failures: ClassifiedError[]): MetricObservation[] {
  const parsed = objectSchema.safeParse(raw);
  if (!parsed.success)
    throw new ConnectorError("invalid_response", "Kimi Code quota response shape changed");
  return windows.flatMap((window) => {
    if (!(window.field in parsed.data)) return [];
    const bucket = objectSchema.safeParse(parsed.data[window.field]);
    const ratio = ratioSchema.safeParse(bucket.success ? bucket.data["used_ratio"] : undefined);
    const percent = ratio.success ? Math.round(ratio.data * 10_000) / 100 : null;
    if (percent === null) failures.push(invalid(window.key, "percentage"));
    return [
      metric(
        window,
        percent,
        readReset(bucket.success ? bucket.data["reset_time"] : undefined, window.key, failures),
      ),
    ];
  });
}

function legacyMetrics(
  payload: Record<string, unknown>,
  failures: ClassifiedError[],
): MetricObservation[] {
  if (!("usage" in payload) && !("limits" in payload))
    throw new ConnectorError("invalid_response", "Kimi Code usage response shape changed");
  const metrics: MetricObservation[] = [];
  if (payload["limits"] !== undefined) {
    if (!Array.isArray(payload["limits"])) failures.push(invalid("quota.five_hour", "window list"));
    else
      for (const raw of payload["limits"]) {
        const bucket = objectSchema.safeParse(raw);
        const window = legacyWindowSchema.safeParse(
          bucket.success ? bucket.data["window"] : undefined,
        );
        if (!window.success) {
          failures.push(invalid("quota.five_hour", "window duration"));
          continue;
        }
        const multiplier = {
          TIME_UNIT_SECOND: 1,
          TIME_UNIT_MINUTE: 60,
          TIME_UNIT_HOUR: 3600,
          TIME_UNIT_DAY: 86_400,
        }[window.data.timeUnit];
        // Unknown provider windows are not silently relabelled as sessions or weeks.
        if (window.data.duration * multiplier !== 18_000) continue;
        metrics.push(
          legacyMetric(
            windows[0],
            bucket.success ? (bucket.data["detail"] ?? bucket.data) : undefined,
            failures,
          ),
        );
      }
  }
  if ("usage" in payload) metrics.push(legacyMetric(windows[1], payload["usage"], failures));
  return metrics;
}

function legacyMetric(
  window: QuotaWindow,
  raw: unknown,
  failures: ClassifiedError[],
): MetricObservation {
  const bucket = objectSchema.safeParse(raw);
  const counts = legacyCountSchema.safeParse(raw);
  const used = counts.success
    ? (counts.data.used ?? counts.data.limit - (counts.data.remaining ?? Number.NaN))
    : Number.NaN;
  const percent = counts.success ? Math.round((used / counts.data.limit) * 10_000) / 100 : null;
  if (percent === null) failures.push(invalid(window.key, "percentage"));
  return metric(
    window,
    percent,
    readReset(bucket.success ? bucket.data["resetTime"] : undefined, window.key, failures),
  );
}

function readReset(raw: unknown, key: string, failures: ClassifiedError[]): number | null {
  if (raw === undefined) return null;
  const parsed = resetSchema.safeParse(raw);
  const at = parsed.success ? Date.parse(parsed.data) : Number.NaN;
  if (Number.isFinite(at)) return at;
  failures.push(invalid(key, "reset time"));
  return null;
}

function metric(
  window: QuotaWindow,
  percent: number | null,
  resetsAt: number | null,
): MetricObservation {
  return {
    providerMetricKey: window.key,
    kind: "quota_percentage",
    scope: window.scope,
    valueText: percent === null ? null : String(percent),
    unit: "percent",
    resetsAt,
    windowEnd: resetsAt,
    availability: percent === null ? "unknown" : "available",
    interface: "private",
  };
}
function invalid(key: string, field: string): ClassifiedError {
  return classified("invalid_response", `Kimi Code ${key} ${field} response shape changed`);
}
