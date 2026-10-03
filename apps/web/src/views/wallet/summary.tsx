import type { ReactNode } from "react";

import type { Provider } from "@headroom/core/contracts";
import { accountName, planLabel, providerName } from "@headroom/view-model/labels";
import { formatMoney, type Total, type WalletSummary } from "@headroom/view-model/wallet";

import { dayLabel, plural } from "./book.ts";

/** What a provider's spend figure is called in the caption. */
const spendSource: Partial<Record<Provider, string>> = {
  claude: "Claude extra usage",
  cursor: "Cursor on-demand",
  vercel_ai_gateway: "Vercel last 30 days",
};

function Stat(props: {
  readonly label: string;
  /** The figure. `null` shows a dash: nothing to show is unknown, not zero. */
  readonly value: string | null;
  /** What shows in place of a missing figure. */
  readonly empty?: string;
  readonly unit?: string;
  readonly captions: readonly (string | null)[];
}) {
  const { value } = props;
  const lines = props.captions.filter((line): line is string => line !== null);
  return (
    <div className="w-stat">
      <dt>{props.label}</dt>
      <dd className={value === null ? "w-num unknown" : "w-num"}>
        {value ?? props.empty ?? "—"}
        {props.unit === undefined || value === null ? null : (
          <span className="unit">{props.unit}</span>
        )}
      </dd>
      <dd className="w-cap">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </dd>
    </div>
  );
}

function leftOut(total: Total): string | null {
  return total.missing === 0
    ? null
    : `Leaves out ${plural(total.missing, "amount", "amounts")} with no exchange rate`;
}

/** "6 paid · 3 free or included · 2 not set", leaving out the parts that are zero. */
function countsLine(counts: WalletSummary["counts"]): string {
  return [
    counts.paid > 0 ? `${counts.paid} paid` : null,
    counts.free + counts.included > 0 ? `${counts.free + counts.included} free or included` : null,
    counts.notSet > 0 ? `${counts.notSet} not set` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** The four stats in one bordered group, split by hairlines. */
export function SummaryBand(props: {
  readonly summary: WalletSummary;
  /** Paid top-ups dated this month; the summary holds only their total. */
  readonly paidTopUps: number;
}) {
  const { summary } = props;
  const accounts = summary.providers.flatMap((provider) => provider.accounts);
  const priced = summary.counts.paid + summary.counts.free + summary.counts.included > 0;

  const sources = summary.providers
    .filter((provider) => provider.accounts.some((account) => account.usageSpend !== null))
    .map(
      (provider) => spendSource[provider.provider] ?? `${providerName(provider.provider)} spend`,
    );

  const topUps = summary.topUpsThisMonth;
  const topUpParts = [
    props.paidTopUps > 0 ? `${props.paidTopUps} paid` : null,
    topUps.freeCount > 0 ? `${topUps.freeCount} free` : null,
  ].filter((part) => part !== null);

  const next = summary.nextRenewal;
  const renewing =
    next === null
      ? undefined
      : accounts.find((account) => account.connection.id === next.connectionId);
  const renewingName =
    renewing === undefined
      ? null
      : `${providerName(renewing.connection.provider)} ${planLabel(renewing.connection.plan) ?? accountName(renewing.connection)}`;

  let usageValue: string | null = formatMoney(summary.usageSpend.money);
  let usageCaptions: readonly (string | null)[] = [sources.join(", "), leftOut(summary.usageSpend)];
  if (sources.length === 0) {
    usageValue = null;
    usageCaptions = ["No account reports spend"];
  }

  const stats: readonly ReactNode[] = [
    priced ? (
      <Stat
        key="subs"
        label="Subscriptions"
        value={formatMoney(summary.monthly.money)}
        unit="/ month"
        captions={[countsLine(summary.counts), leftOut(summary.monthly)]}
      />
    ) : (
      <Stat
        key="subs"
        label="Subscriptions"
        value={null}
        empty="Not Set"
        captions={["Set what each account costs to see your monthly total."]}
      />
    ),
    <Stat key="usage" label="Usage Spend" value={usageValue} captions={usageCaptions} />,
    <Stat
      key="topups"
      label="Top-Ups This Month"
      value={formatMoney(topUps.paid.money)}
      captions={[
        topUpParts.length === 0 ? "None this month" : topUpParts.join(" · "),
        leftOut(topUps.paid),
      ]}
    />,
    <Stat
      key="renewal"
      label="Next Renewal"
      value={next === null ? null : dayLabel(next.date)}
      captions={
        next === null
          ? ["No renewal date set"]
          : [
              renewingName === null
                ? formatMoney(next.price)
                : `${renewingName} · ${formatMoney(next.price)}`,
            ]
      }
    />,
  ];
  return <dl className="w-band">{stats}</dl>;
}
