import type { AutoResetRule, Provider, SpendBudget } from "@headroom/core/contracts";

import type { OverviewConnection } from "./overview.ts";

/**
 * What the Automations settings list: accounts that can use a banked reset, and the spend figures an owner can
 * set a budget on. See docs/decisions/0003-owner-automations.md.
 */

/** Accounts whose connector supports using a banked reset, so an auto-reset rule can exist. */
export function autoResetAccounts(
  connections: readonly OverviewConnection[],
): OverviewConnection[] {
  return connections.filter((connection) =>
    connection.actions.supported.includes("consume_reset_credit"),
  );
}

const windowWords: Record<AutoResetRule["window"], string> = {
  weekly: "weekly",
  session: "5-hour",
  either: "weekly or 5-hour",
};

/** One sentence on what a rule does, for a tooltip. */
export function autoResetSummary(rule: AutoResetRule): string {
  const hours = rule.minHoursLeft === 1 ? "1 hour" : `${rule.minHoursLeft} hours`;
  return `Uses the banked reset that expires first when a ${windowWords[rule.window]} limit reaches ${rule.thresholdPercent}% used and its own reset is more than ${hours} away.`;
}

/** The owner's name for a spend figure, as the notices word it. */
export function spendLabel(provider: Provider, key: string): string {
  if (key === "extra_usage.used") return "Extra Usage";
  if (key === "on_demand.used") return provider === "grok" ? "On-Demand Use" : "On-Demand Spend";
  if (key === "spend.30d") return "30-Day Spend";
  return key;
}

/** One spend figure of one account, with the owner's budget on it when there is one. */
export interface SpendRow {
  readonly connection: OverviewConnection;
  readonly metricKey: string;
  readonly label: string;
  /** Dollars, or the provider's own credits. Never converted. */
  readonly unit: "USD" | "credits";
  /** The latest reading, or null when it is unknown or unavailable: unknown is not zero. */
  readonly value: number | null;
  readonly budget: SpendBudget | null;
}

/**
 * Every `spend` metric an account reports, in snapshot order. A metric the provider cannot report right now is
 * listed only when it already has a budget, so the owner can still change or clear it.
 */
export function spendRows(connections: readonly OverviewConnection[]): SpendRow[] {
  return connections.flatMap((connection) =>
    (connection.snapshot?.metrics ?? []).flatMap((metric): SpendRow[] => {
      if (metric.kind !== "spend") return [];
      const budget =
        connection.automation.budgets.find((item) => item.metricKey === metric.providerMetricKey) ??
        null;
      const known =
        metric.availability === "available" &&
        metric.unlimited !== true &&
        metric.valueNum !== null &&
        Number.isFinite(metric.valueNum);
      if (!known && budget === null) return [];
      return [
        {
          connection,
          metricKey: metric.providerMetricKey,
          label: spendLabel(connection.provider, metric.providerMetricKey),
          unit: metric.unit === "USD" ? "USD" : "credits",
          value: known ? metric.valueNum : null,
          budget,
        },
      ];
    }),
  );
}
