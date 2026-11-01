import {
  apiTokenScopeSchema,
  availabilitySchema,
  connectionStateSchema,
  currencySchema,
  interfaceLabelSchema,
  notificationEventSchema,
  providerSchema,
  reconnectReasonSchema,
  refreshIntervalMinutesSchema,
  type MetricKind,
  type Provider,
} from "@headroom/core/contracts";
import { z } from "zod";

import { leftOf, meterWindows } from "./accounts.ts";
import { spendLabel, spendPairs } from "./automation.ts";
import { accountName, planLabel } from "./labels.ts";
import {
  deriveNotifications,
  expiringTopUps,
  metricOf,
  numberOf,
  projectedRunOut,
  type NotificationSettings,
} from "./notifications.ts";
import type { OverviewConnection } from "./overview.ts";
import { presentPanel } from "./present.ts";
import { summarize, type WalletBook } from "./wallet.ts";
import type { Rates } from "./wallet-money.ts";

const instant = z.number().int().nonnegative();
const amountSchema = z.strictObject({ value: z.number(), unit: z.string() });
const moneySchema = z.strictObject({ minor: z.number().int(), currency: currencySchema });
const limitSchema = z.strictObject({
  key: z.string(),
  label: z.string(),
  window: z.string().nullable(),
  windowKind: z.enum(["session", "weekly", "cycle", "other"]),
  percentLeft: z.number().min(0).max(100).nullable(),
  unlimited: z.boolean(),
  notStarted: z.boolean(),
  resetsAt: instant.nullable(),
  resetWords: z.enum(["resets", "cycle_end", "not_started"]),
  runsOutAt: instant.nullable(),
  part: z.boolean(),
  interface: interfaceLabelSchema,
});
const chargeSchema = z.strictObject({
  key: z.string(),
  label: z.string(),
  kind: z.enum(["spend", "balance", "count"]),
  value: z.number().nullable(),
  unit: z.string(),
  cap: amountSchema.nullable(),
  window: z.string().nullable(),
  unlimited: z.boolean(),
  availability: availabilitySchema,
  interface: interfaceLabelSchema,
});
const bankedSchema = z.strictObject({
  count: z.number().nonnegative().nullable(),
  unit: z.string(),
  expiries: z.array(instant),
  interface: interfaceLabelSchema,
});

export const appWhoamiSchema = z.strictObject({
  apiVersion: z.literal(1),
  serverVersion: z.string(),
  tokenName: z.string().nullable(),
  /**
   * `read` always; `refresh` when the owner let this token change Refresh Every. Optional in the
   * contract because servers before D44 omit it, and a client must still accept them.
   */
  scopes: z.array(apiTokenScopeSchema).optional(),
});

/** The body and the response of `PUT /api/app/v1/settings/refresh`. */
export const appRefreshSchema = z.strictObject({
  refreshIntervalMinutes: refreshIntervalMinutesSchema,
});

/** Most ids one read call may carry. The dashboard never holds more notices than this. */
export const noticeReadLimit = 500;

/** The body of `PUT /api/app/v1/notices/read` and of the dashboard's `PUT /api/notices/read`. */
export const noticeReadBodySchema = z.strictObject({
  ids: z.array(z.string().min(1).max(300)).max(noticeReadLimit),
  read: z.boolean(),
});

/** Every notice id marked read, as `GET /api/notices/read` and the dashboard's `PUT` answer. */
export const noticeReadSetSchema = z.strictObject({ ids: z.array(z.string()) });

/** The only account projection exposed to native clients. Add fields here explicitly. */
export const appFeedSchema = z.strictObject({
  apiVersion: z.literal(1),
  serverVersion: z.string(),
  generatedAt: instant,
  refreshIntervalMs: z.number().int().positive(),
  staleAfterMs: z.number().int().positive(),
  dashboardUrl: z.url().nullable(),
  providerOrder: z.array(providerSchema),
  accounts: z.array(
    z.strictObject({
      id: z.string(),
      provider: providerSchema,
      name: z.string(),
      plan: z.string().nullable(),
      identity: z.string().nullable(),
      state: connectionStateSchema,
      reconnectReason: reconnectReasonSchema.nullable(),
      interface: interfaceLabelSchema,
      lastSuccessAt: instant.nullable(),
      observedAt: instant.nullable(),
      limits: z.array(limitSchema),
      charges: z.array(chargeSchema),
      banked: bankedSchema.nullable(),
    }),
  ),
  summary: z.strictObject({
    monthlyPlanTotal: moneySchema.nullable(),
    extraSpend: z.array(z.strictObject({ unit: z.string(), value: z.number().nullable() })),
    nextLimitBack: z
      .strictObject({ accountId: z.string(), metricKey: z.string(), at: instant })
      .nullable(),
  }),
  notices: z.array(notificationEventSchema.extend({ read: z.boolean() })),
});

type Feed = z.infer<typeof appFeedSchema>;
type Charge = z.infer<typeof chargeSchema>;

interface FeedInput {
  readonly connections: readonly OverviewConnection[];
  readonly providerOrder: readonly Provider[];
  readonly serverVersion: string;
  readonly generatedAt: number;
  readonly refreshIntervalMs: number;
  readonly staleAfterMs: number;
  readonly dashboardUrl: string | null;
  readonly settings: NotificationSettings;
  readonly wallet: WalletBook;
  readonly rates: Rates | null;
  readonly tzOffsetMinutes: number;
  /** Ids of the notices the owner has read. */
  readonly read: ReadonlySet<string>;
}

const chargeKinds: ReadonlySet<MetricKind> = new Set([
  "spend",
  "currency_balance",
  "credits",
  "absolute_quota",
]);

type Panel = ReturnType<typeof presentPanel>;

function chargesOf(connection: OverviewConnection, panel: Panel): Charge[] {
  const metrics = connection.snapshot?.metrics ?? [];
  const pair = spendPairs[connection.provider];
  // A cap is shown with the figure it limits, never as a row of its own.
  const capKeys = new Set([pair?.cap, "cloud_credits.limit"]);
  return metrics.flatMap((metric): Charge[] => {
    if (!chargeKinds.has(metric.kind)) return [];
    if (capKeys.has(metric.providerMetricKey)) return [];
    const cell = panel.cells.find((item) => item.key === metric.providerMetricKey);
    const fact = panel.facts.find((item) => item.key === metric.providerMetricKey);
    const capKey =
      pair?.used === metric.providerMetricKey
        ? pair.cap
        : metric.providerMetricKey === "cloud_credits.remaining"
          ? "cloud_credits.limit"
          : null;
    const cap = capKey === null ? null : metricOf(connection, capKey);
    const capValue = numberOf(cap);
    const sameScope =
      pair?.used !== metric.providerMetricKey || !pair.sameScope || cap?.scope === metric.scope;
    return [
      {
        key: metric.providerMetricKey,
        label:
          cell?.label ?? fact?.label ?? spendLabel(connection.provider, metric.providerMetricKey),
        kind:
          metric.kind === "spend"
            ? "spend"
            : metric.kind === "currency_balance" ||
                (cell?.kind === "amount" && cell.balance) ||
                metric.providerMetricKey === "prepaid_balance"
              ? "balance"
              : "count",
        value: numberOf(metric),
        unit: metric.unit,
        // A cap of zero means off, as in the spend notices.
        cap:
          capValue === null || capValue <= 0 || cap?.unit !== metric.unit || !sameScope
            ? null
            : { value: capValue, unit: cap.unit },
        window: cell?.window ?? null,
        unlimited: metric.unlimited === true,
        availability: metric.availability,
        interface: metric.interface,
      },
    ];
  });
}

function bankedOf(
  connection: OverviewConnection,
  panel: Panel,
): Feed["accounts"][number]["banked"] {
  const resets = panel.cells.find((cell) => cell.kind === "resets");
  const metric = connection.snapshot?.metrics.find((item) => item.kind === "reset_inventory");
  if (panel.banked === null && resets?.kind !== "resets" && metric === undefined) return null;
  return {
    count: panel.banked?.count ?? (resets?.kind === "resets" ? resets.count : numberOf(metric)),
    unit:
      panel.banked?.label ??
      (resets?.kind === "resets" ? resets.label : (metric?.unit ?? "resets")),
    expiries: [...(panel.banked?.expiries ?? (resets?.kind === "resets" ? resets.expiries : []))],
    interface: metric?.interface ?? connection.interface,
  };
}

/** Pure: the caller supplies the representation time, preferences, Wallet and stored rates. */
export function buildAppFeed(input: FeedInput): Feed {
  const accounts = input.connections.map((connection) => {
    const panel = presentPanel(connection);
    return {
      id: connection.id,
      provider: connection.provider,
      name: accountName(connection),
      plan: planLabel(connection.plan),
      identity: connection.identity,
      state: connection.state,
      reconnectReason: connection.reconnectReason,
      interface: connection.interface,
      lastSuccessAt: connection.lastSuccessAt,
      observedAt: connection.snapshot?.observedAt ?? null,
      limits: meterWindows(connection).map((window) => {
        const runsOutAt = projectedRunOut(
          connection,
          window,
          connection.snapshot?.observedAt ?? input.generatedAt,
        );
        return {
          key: window.key,
          label: window.label,
          window: window.window,
          windowKind: window.kind,
          percentLeft: leftOf(window),
          unlimited: window.unlimited,
          notStarted: window.notStarted,
          resetsAt: window.resetsAt,
          resetWords: window.resetWords,
          // The notices' recent-rate projection, anchored to the reading rather than the request,
          // without the pacing notice's one-day lead: the popover shows any run-out before the reset.
          runsOutAt,
          part:
            connection.provider === "cursor" &&
            ["included.auto_percent", "included.api_percent"].includes(window.key),
          interface: metricOf(connection, window.key)?.interface ?? connection.interface,
        };
      }),
      charges: chargesOf(connection, panel),
      banked: bankedOf(connection, panel),
    };
  });
  const totals = new Map<string, number | null>();
  for (const charge of accounts.flatMap((account) => account.charges)) {
    if (charge.kind !== "spend") continue;
    const previous = totals.get(charge.unit);
    totals.set(
      charge.unit,
      previous === null || charge.value === null ? null : (previous ?? 0) + charge.value,
    );
  }
  const wallet = summarize(
    input.connections,
    input.providerOrder,
    input.wallet,
    input.rates,
    input.generatedAt,
  );
  const hasCost = wallet.counts.paid + wallet.counts.free + wallet.counts.included > 0;
  const nextLimitBack =
    accounts
      .filter((account) => account.state === "ready" || account.state === "partial")
      .flatMap((account) =>
        account.limits
          .filter(
            (limit) =>
              !limit.part &&
              limit.percentLeft === 0 &&
              limit.resetsAt !== null &&
              limit.resetsAt > input.generatedAt,
          )
          .map((limit) => ({ accountId: account.id, metricKey: limit.key, at: limit.resetsAt! })),
      )
      .toSorted((a, b) => a.at - b.at)[0] ?? null;
  const notices = deriveNotifications(
    input.connections,
    {
      ...input.settings,
      timeStyle: "exact",
      tzOffsetMinutes: input.tzOffsetMinutes,
    },
    input.generatedAt,
    expiringTopUps(input.wallet.topUps),
  ).map((event) =>
    Object.assign({}, event, {
      read: input.read.has(event.id),
      links: input.dashboardUrl === null ? {} : { dashboard: input.dashboardUrl },
    }),
  );
  return appFeedSchema.parse({
    apiVersion: 1,
    serverVersion: input.serverVersion,
    generatedAt: input.generatedAt,
    refreshIntervalMs: input.refreshIntervalMs,
    staleAfterMs: input.staleAfterMs,
    dashboardUrl: input.dashboardUrl,
    providerOrder: [...input.providerOrder],
    accounts,
    summary: {
      monthlyPlanTotal: hasCost && wallet.monthly.missing === 0 ? wallet.monthly.money : null,
      extraSpend: [...totals]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([unit, value]) => ({ unit, value })),
      nextLimitBack,
    },
    notices,
  });
}
