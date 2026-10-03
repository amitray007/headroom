import { useId, useState } from "react";

import "./spend.css";

import { BrandMark } from "../../icons.tsx";
import { providerName } from "@headroom/view-model/labels";
import { providerShares, type Total, type WalletSummary } from "@headroom/view-model/wallet";
import { formatMoney, type Currency } from "@headroom/view-model/wallet-money";

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

interface Fact {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The three figures beside the chart: what the dataset adds up to over time, per item, and what it leaves out. */
function factsOf(summary: WalletSummary, dataset: Dataset): readonly Fact[] {
  const { monthly, usageSpend, counts, currency } = summary;
  const money = (minor: number): string => formatMoney({ minor: Math.round(minor), currency });
  if (dataset === "monthly") {
    return [
      { label: "Per year", value: money(monthly.money.minor * 12), sub: "At today's prices" },
      {
        label: "Per paid plan",
        value: counts.paid === 0 ? "—" : money(monthly.money.minor / counts.paid),
        sub: plural(counts.paid, "paid plan", "paid plans"),
      },
      {
        label: "Free or included",
        value: plural(counts.free + counts.included, "account", "accounts"),
        sub: "Counted as nothing",
      },
    ];
  }
  // The same all-in total the summary band shows, so the share and the band never disagree.
  const allIn = summary.allIn.money.minor;
  const accounts = summary.providers.flatMap((provider) => provider.accounts);
  const reporting = accounts.filter((account) => account.usageSpend !== null).length;
  const top = providerShares(summary.providers, "usageSpend")[0];
  return [
    {
      label: "Accounts reporting",
      value: `${reporting} of ${accounts.length}`,
      sub: "Report spend in money",
    },
    {
      label: "Largest",
      value: top === undefined ? "—" : money(top.minor),
      ...(top === undefined ? {} : { sub: providerName(top.provider) }),
    },
    {
      label: "Share of all-in",
      value: allIn === 0 ? "—" : `${Math.round((usageSpend.money.minor / allIn) * 100)}%`,
      sub: "Spent on usage",
    },
  ];
}

const shareFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * Spend by provider: one card with a switch between subscriptions and usage spend. The total and its three figures
 * on one line, then one bar split by provider, then a legend grid; a few parts fill the width instead of leaving a
 * ring in empty space.
 */
export function SpendByProvider(props: { readonly summary: WalletSummary }) {
  const { summary } = props;
  const [dataset, setDataset] = useState<Dataset>("monthly");
  const [active, setActive] = useState<string | null>(null);
  const headingId = useId();
  const currency: Currency = summary.currency;
  const total = dataset === "monthly" ? summary.monthly : summary.usageSpend;
  const shares = providerShares(summary.providers, dataset);
  const sum = shares.reduce((acc, share) => acc + share.minor, 0);
  const parts = shares.map((share, index) => ({
    provider: share.provider,
    label: providerName(share.provider),
    display: formatMoney({ minor: share.minor, currency }),
    share: sum === 0 ? 0 : share.minor / sum,
    color: `var(--series-${String(Math.min(index + 1, 7))})`,
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
            onChange={(next) => {
              setDataset(next);
              setActive(null);
            }}
          />
        </header>
        <div className="sp-body">
          <div className="sp-top">
            <div className="sp-total">
              <span className="sp-total-label">{datasets[dataset].center}</span>
              <span className="sp-total-value num">{formatMoney(total.money)}</span>
              {note === undefined ? null : <span className="sp-total-note">{note}</span>}
            </div>
            <dl className="sp-facts">
              {factsOf(summary, dataset).map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd className="num">{fact.value}</dd>
                  {fact.sub === undefined ? null : <dd className="sp-fact-sub">{fact.sub}</dd>}
                </div>
              ))}
            </dl>
          </div>
          {parts.length === 0 ? (
            <p className="w-spend-empty muted">{datasets[dataset].empty}</p>
          ) : (
            <>
              {/* The legend carries every value for assistive tech; the bar is its picture. */}
              <div className="sp-bar" aria-hidden="true" data-active={active ?? undefined}>
                {parts.map((part) => (
                  <span
                    key={part.provider}
                    className="sp-seg"
                    data-on={active === part.provider ? "" : undefined}
                    style={{ flexGrow: part.share, background: part.color }}
                    title={`${part.label} · ${part.display}`}
                    onPointerEnter={() => setActive(part.provider)}
                    onPointerLeave={() => setActive(null)}
                  />
                ))}
              </div>
              <ul className="sp-legend" aria-label={datasets[dataset].chart}>
                {parts.map((part) => (
                  <li
                    key={part.provider}
                    data-on={active === part.provider ? "" : undefined}
                    data-dim={active !== null && active !== part.provider ? "" : undefined}
                    onPointerEnter={() => setActive(part.provider)}
                    onPointerLeave={() => setActive(null)}
                  >
                    <span
                      className="sp-dot"
                      style={{ background: part.color }}
                      aria-hidden="true"
                    />
                    <BrandMark provider={part.provider} />
                    <span className="sp-name">{part.label}</span>
                    <span className="sp-amount num">{part.display}</span>
                    <span className="sp-share num">{shareFormat.format(part.share * 100)}%</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
