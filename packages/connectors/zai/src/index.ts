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
  timeoutFetch,
} from "@headroom/core";
import { apiHeaders, quotaUrl } from "./endpoints.ts";
import { customerIdentity, checkAuthentication, readJson } from "./http.ts";
import { createZaiLogin } from "./login.ts";
import { readResetInventory } from "./resets.ts";
import {
  bucketSchema,
  countSchema,
  countsSchema,
  credentialSchema,
  envelopeSchema,
  percentSchema,
  resetSchema,
} from "./schemas.ts";

export const zaiConnectorVersion = "0.3.0";

export function createZaiConnector(
  options: { readonly fetch?: FetchLike; readonly now?: () => number } = {},
): Connector {
  const request = timeoutFetch(options.fetch);
  const now = options.now ?? Date.now;

  async function quota(credential: StoredCredential): Promise<readonly unknown[]> {
    const parsed = credentialSchema.safeParse(credential.secret);
    if (!parsed.success)
      throw new ConnectorError("invalid_response", "Z.ai credential is unreadable");
    const secret = parsed.data;
    const body = await readJson(request, quotaUrl, "Z.ai quota", {
      method: "GET",
      headers:
        "apiKey" in secret ? apiHeaders(secret.apiKey) : apiHeaders(secret.accessToken, true),
    });
    checkAuthentication(body);
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success)
      throw new ConnectorError(
        "invalid_response",
        "Z.ai quota response shape changed or Coding Plan is unavailable",
      );
    return envelope.data.data.limits;
  }

  return {
    provider: "zai",
    version: zaiConnectorVersion,
    interface: "private",
    supportedMethods: ["approval_poll"],
    ...createZaiLogin(request, now),
    async identity(credential) {
      const parsed = credentialSchema.safeParse(credential.secret);
      if (!parsed.success)
        throw new ConnectorError("authentication_required", "Z.ai stored credential is unreadable");
      const secret = parsed.data;
      if ("accessToken" in secret) {
        const accountId = await customerIdentity(request, secret.accessToken);
        if (accountId !== secret.accountId)
          throw new ConnectorError("identity_mismatch", "Z.ai session belongs to another account");
        return {
          providerAccountId: `zai:${accountId}`,
          workspaceId: null,
          label: secret.label,
          assurance: "strong",
        };
      }
      await quota(credential);
      const fingerprint = new Bun.CryptoHasher("sha256").update(secret.apiKey).digest("hex");
      return {
        providerAccountId: `zai-key:${fingerprint}`,
        workspaceId: null,
        label: "Z.ai Coding Plan",
        assurance: "weak",
      };
    },
    capabilities(credential): Promise<readonly Capability[]> {
      const secret = credentialSchema.parse(credential.secret);
      return Promise.resolve([
        ...["quota.18000s", "quota.604800s", "mcp.monthly"].map((metricOrAction): Capability => ({
          metricOrAction,
          availability: "unknown",
          interface: "private",
          evidenceLevel: "source_inspected",
          reason: "Reported pools are probed on each collection; MCP is optional",
        })),
        ...[
          "reset_credits.available_count",
          "reset_credits.five_hour.available_count",
          "reset_credits.weekly.available_count",
        ].map((metricOrAction): Capability => ({
          metricOrAction,
          availability: "apiKey" in secret ? "unsupported" : "unknown",
          interface: "private",
          evidenceLevel: "source_inspected",
          reason:
            "apiKey" in secret
              ? "Reset cards require browser sign-in"
              : secret.zcodeToken === undefined
                ? "Sign in to Z.ai again to load reset cards"
                : "Already-granted reset cards are read without requesting or using one",
        })),
      ]);
    },
    async collect(credential, expected): Promise<CollectResult> {
      const parsed = credentialSchema.safeParse(credential.secret);
      if (parsed.success && "accessToken" in parsed.data) {
        const accountId = await customerIdentity(request, parsed.data.accessToken);
        if (
          accountId !== parsed.data.accountId ||
          expected.providerAccountId !== `zai:${accountId}`
        )
          throw new ConnectorError(
            "identity_mismatch",
            "Z.ai quota session belongs to another account",
          );
      }
      const usage = parseQuota(await quota(credential), now());
      const inventory = await readResetInventory(
        request,
        credentialSchema.parse(credential.secret),
        usage.observedAt,
      );
      return {
        ...usage,
        metrics: [...usage.metrics, ...inventory.metrics],
        resetCredits: inventory.resetCredits ?? [],
        failures: [...usage.failures, ...inventory.failures],
      };
    },
    disconnect: () => Promise.resolve("local_only"),
    classify: classifyUnknown,
  };
}

const windowUnits: Readonly<Record<number, number>> = { 1: 86400, 3: 3600, 5: 60, 6: 604800 };
const requiredWindows = [18000, 604800];
function unknownMeter(seconds: number): MetricObservation {
  return meter(`quota.${seconds}s`, `window:${seconds}s`, null, null);
}
function meter(
  key: string,
  scope: string,
  value: number | null,
  resetsAt: number | null,
): MetricObservation {
  return {
    providerMetricKey: key,
    kind: "quota_percentage",
    scope,
    valueText: value === null ? null : String(value),
    unit: "percent",
    availability: value === null ? "unknown" : "available",
    interface: "private",
    resetsAt,
  };
}

function parseQuota(limits: readonly unknown[], observedAt: number): CollectResult {
  const metrics = new Map(
    requiredWindows.map((seconds) => [`quota.${seconds}s`, unknownMeter(seconds)]),
  );
  const seen = new Set<string>();
  const failures: ClassifiedError[] = [];
  const invalid = () =>
    failures.push(classified("invalid_response", "Z.ai returned an unreadable quota field"));
  for (const raw of limits) {
    const parsed = bucketSchema.safeParse(raw);
    if (!parsed.success) {
      invalid();
      continue;
    }
    const bucket = parsed.data;
    const coding = bucket.type === "CREDIT_LIMIT" || bucket.type === "TOKENS_LIMIT";
    const monthly = bucket.type === "TIME_LIMIT" && bucket.unit === 5 && bucket.number === 1;
    const multiplier = windowUnits[bucket.unit];
    if ((!coding && !monthly) || (coding && multiplier === undefined)) {
      failures.push(classified("unsupported_metric", "Z.ai returned an unsupported quota bucket"));
      continue;
    }
    const seconds = coding && multiplier !== undefined ? bucket.number * multiplier : null;
    const key = seconds === null ? "mcp.monthly" : `quota.${seconds}s`;
    const scope = seconds === null ? "window:monthly" : `window:${seconds}s`;
    if (seen.has(key)) {
      metrics.set(key, meter(key, scope, null, null));
      for (const suffix of ["used", "limit", "remaining"]) metrics.delete(`${key}.${suffix}`);
      invalid();
      continue;
    }
    seen.add(key);
    const parsedPercent = percentSchema.safeParse(bucket["percentage"]);
    let percent = parsedPercent.success ? parsedPercent.data : null;
    if (percent === null) invalid();
    // Provider percentage is often rounded. Refine only when all needed counts are valid.
    const counts = countsSchema.safeParse(bucket);
    if (percent !== null && counts.success) {
      const { usage, currentValue, remaining } = counts.data;
      const used = Math.max(currentValue ?? 0, remaining === undefined ? 0 : usage - remaining);
      percent = Math.min(100, (used / usage) * 100);
    }
    const reset = resetSchema.safeParse(bucket["nextResetTime"]);
    const resetsAt = reset.success ? reset.data : null;
    if (bucket["nextResetTime"] !== null && bucket["nextResetTime"] !== undefined && !reset.success)
      invalid();
    metrics.set(key, meter(key, scope, percent, resetsAt));
    if (monthly) {
      for (const [field, suffix] of [
        ["currentValue", "used"],
        ["usage", "limit"],
        ["remaining", "remaining"],
      ] as const) {
        if (!(field in bucket)) continue;
        const count = countSchema.safeParse(bucket[field]);
        if (!count.success) invalid();
        metrics.set(`${key}.${suffix}`, {
          providerMetricKey: `${key}.${suffix}`,
          kind: "absolute_quota",
          scope,
          valueText: count.success ? String(count.data) : null,
          unit: "requests",
          availability: count.success ? "available" : "unknown",
          interface: "private",
          resetsAt,
        });
      }
    }
  }
  for (const seconds of requiredWindows) {
    if (!seen.has(`quota.${seconds}s`)) invalid();
  }
  return { observedAt, metrics: [...metrics.values()], failures };
}
