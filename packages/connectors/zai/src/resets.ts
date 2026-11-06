import {
  type Availability,
  type CollectResult,
  ConnectorError,
  type FetchLike,
  type MetricObservation,
  type ResetCreditObservation,
  classified,
  classifyUnknown,
} from "@headroom/core";
import { resetHeaders, resetStatusUrl } from "./endpoints.ts";
import { checkAuthentication, readJson } from "./http.ts";
import { resetBusySchema, resetCardsSchema, resetInventoryEnvelopeSchema } from "./schemas.ts";

type Inventory = Pick<CollectResult, "metrics" | "resetCredits" | "failures">;
const windows = [
  {
    name: "five_hour",
    field: "available_five_hour_resets",
    scope: "window:18000s",
    label: "5-hour reset",
  },
  {
    name: "weekly",
    field: "available_week_resets",
    scope: "window:604800s",
    label: "Weekly reset",
  },
] as const;
function countMetric(
  key: string,
  scope: string,
  count: number | null,
  availability: Availability = count === null ? "unknown" : "available",
): MetricObservation {
  return {
    providerMetricKey: key,
    scope,
    kind: "reset_inventory",
    valueText: count === null ? null : String(count),
    unit: "resets",
    availability,
    interface: "private",
  };
}
function unknown(availability: Availability = "unknown"): MetricObservation[] {
  return [
    countMetric("reset_credits.available_count", "account", null, availability),
    ...windows.map((window) =>
      countMetric(`reset_credits.${window.name}.available_count`, window.scope, null, availability),
    ),
  ];
}

/** Optional read-only inventory. Reset credentials cannot revoke an otherwise working quota session. */
export async function readResetInventory(
  http: FetchLike,
  secret: { apiKey: string } | { accessToken: string; zcodeToken?: string | undefined },
  observedAt: number,
): Promise<Inventory> {
  if ("apiKey" in secret)
    return { metrics: unknown("unsupported"), resetCredits: [], failures: [] };
  if (secret.zcodeToken === undefined)
    return {
      metrics: unknown(),
      resetCredits: [],
      failures: [
        classified(
          "unsupported_metric",
          "Sign in to Z.ai again to load reset cards; the existing usage session is still connected",
        ),
      ],
    };
  try {
    const body = await readJson(http, resetStatusUrl, "Z.ai reset-card inventory", {
      method: "GET",
      headers: resetHeaders(secret.zcodeToken, secret.accessToken),
    });
    checkAuthentication(body);
    if (resetBusySchema.safeParse(body).success)
      throw new ConnectorError(
        "provider_unavailable",
        "Z.ai reset-card service is temporarily unavailable",
      );
    const envelope = resetInventoryEnvelopeSchema.safeParse(body);
    if (!envelope.success)
      throw new ConnectorError(
        "invalid_response",
        "Z.ai reset-card inventory response shape changed",
      );
    const metrics: MetricObservation[] = [];
    const resetCredits: ResetCreditObservation[] = [];
    const failures: CollectResult["failures"][number][] = [];
    let total: number | null = 0;
    for (const window of windows) {
      const parsed = resetCardsSchema.safeParse(envelope.data.data[window.field]);
      if (!parsed.success) {
        metrics.push(
          countMetric(`reset_credits.${window.name}.available_count`, window.scope, null),
        );
        failures.push(
          classified("invalid_response", `Z.ai ${window.label} inventory response shape changed`),
        );
        total = null;
        continue;
      }
      const expiries = parsed.data
        .map((card) => card.expire_at)
        .filter((at) => at > observedAt)
        .toSorted((a, b) => a - b);
      metrics.push(
        countMetric(`reset_credits.${window.name}.available_count`, window.scope, expiries.length),
      );
      if (total !== null) total += expiries.length;
      const ordinals = new Map<number, number>();
      for (const at of expiries) {
        const ordinal = ordinals.get(at) ?? 0;
        ordinals.set(at, ordinal + 1);
        resetCredits.push({
          providerCreditId: `${window.name}:${at}:${ordinal}`,
          eligible: true,
          usable: true,
          expiresAt: at,
          rawLabel: window.label,
        });
      }
    }
    return {
      metrics: [countMetric("reset_credits.available_count", "account", total), ...metrics],
      resetCredits,
      failures,
    };
  } catch (error) {
    const failure = classifyUnknown(error);
    const safeFailure =
      failure.class === "definitive"
        ? classified(
            "permission_denied",
            "Z.ai reset-card sign-in expired or was rejected; sign in again to reload cards",
          )
        : failure;
    return { metrics: unknown(), resetCredits: [], failures: [safeFailure] };
  }
}
