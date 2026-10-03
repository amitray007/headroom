import { useId, useState } from "react";

import { BrandMark } from "../../icons.tsx";
import { providerName } from "@headroom/view-model/labels";
import { providerShares, type Total, type WalletSummary } from "@headroom/view-model/wallet";
import { formatMoney, type Currency } from "@headroom/view-model/wallet-money";

import { DonutChart, type DonutSegment } from "../../ui/donut-chart.tsx";
import { Segmented } from "../../ui/segmented.tsx";

type Dataset = "monthly" | "usageSpend";

const datasets: Record<
  Dataset,
  { readonly center: string; readonly chart: string; readonly empty: string }
> = {
  monthly: {
    center: "Per month",
    chart: "Subscriptions per month by provider",
    empty: "No paid subscriptions to chart.",
  },
  usageSpend: {
    center: "Usage spend",
    chart: "Usage spend by provider",
    empty: "No account reports usage spend.",
  },
};

const options = [
  { value: "monthly", label: "Subscriptions" },
  { value: "usageSpend", label: "Usage Spend" },
] as const;

/** "2 amounts left out, no rate" for a total that dropped some, or nothing. */
function leftOut(total: Total): string | undefined {
  return total.missing === 0
    ? undefined
    : `${total.missing} ${total.missing === 1 ? "amount" : "amounts"} left out, no rate`;
}

/** Spend by provider: one card with a switch between subscriptions and usage spend, and a donut of the split. */
export function SpendByProvider(props: { readonly summary: WalletSummary }) {
  const { summary } = props;
  const [dataset, setDataset] = useState<Dataset>("monthly");
  const headingId = useId();
  const currency: Currency = summary.currency;
  const total = dataset === "monthly" ? summary.monthly : summary.usageSpend;
  const segments = providerShares(summary.providers, dataset).map((share): DonutSegment => ({
    key: share.provider,
    label: providerName(share.provider),
    value: share.minor,
    display: formatMoney({ minor: share.minor, currency }),
    icon: <BrandMark provider={share.provider} />,
  }));
  const note = leftOut(total);
  return (
    <section className="w-spend" aria-labelledby={headingId}>
      <div className="w-card">
        <header className="w-card-head">
          <h2 id={headingId}>Spend by Provider</h2>
          <Segmented
            label="Spend to show"
            value={dataset}
            options={options}
            onChange={setDataset}
          />
        </header>
        <div className="w-card-body">
          {segments.length === 0 ? (
            <p className="w-spend-empty muted">{datasets[dataset].empty}</p>
          ) : (
            <DonutChart
              label={datasets[dataset].chart}
              segments={segments}
              centerLabel={datasets[dataset].center}
              centerValue={formatMoney(total.money)}
              {...(note === undefined ? {} : { centerMeta: note })}
            />
          )}
        </div>
      </div>
    </section>
  );
}
