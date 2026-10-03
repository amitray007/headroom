import { useId, useState } from "react";

import "./spend.css";

import { BrandMark } from "../../icons.tsx";
import { providerName } from "@headroom/view-model/labels";
import { providerSpend, type ProviderSpend, type WalletSummary } from "@headroom/view-model/wallet";
import { formatMoney, type Currency } from "@headroom/view-model/wallet-money";

const shareFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A ring arc from angle `a0` to `a1` (radians, clockwise from the top), `w` thick, inside a circle of radius `r`. */
function arcPath(c: number, r: number, w: number, a0: number, a1: number): string {
  const at = (angle: number, radius: number): string =>
    `${(c + radius * Math.sin(angle)).toFixed(2)},${(c - radius * Math.cos(angle)).toFixed(2)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M${at(a0, r)}`,
    `A${r},${r} 0 ${large} 1 ${at(a1, r)}`,
    `L${at(a1, r - w)}`,
    `A${r - w},${r - w} 0 ${large} 0 ${at(a0, r - w)}`,
    "Z",
  ].join(" ");
}

/** The share ring: one arc per provider, 2px gaps, the hovered one at full strength and the rest dimmed. */
function Ring(props: {
  readonly parts: readonly ProviderSpend[];
  readonly colors: ReadonlyMap<string, string>;
  readonly active: string | null;
  readonly onActive: (provider: string | null) => void;
}) {
  const size = 220;
  const c = size / 2;
  const total = props.parts.reduce((sum, part) => sum + part.total, 0);
  const gap = props.parts.length > 1 ? 0.035 : 0;
  // Each arc starts where the providers before it end.
  const starts = props.parts.map((_, index) =>
    props.parts.slice(0, index).reduce((sum, part) => sum + (part.total / total) * Math.PI * 2, 0),
  );
  return (
    <svg className="sp-ring" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {props.parts.map((part, index) => {
        const start = starts[index] ?? 0;
        const span = (part.total / total) * Math.PI * 2;
        const a0 = start + gap / 2;
        const a1 = Math.max(a0 + 0.001, start + span - gap / 2);
        return (
          <path
            key={part.provider}
            d={arcPath(c, c, 26, a0, Math.min(a1, a0 + Math.PI * 2 - 0.0001))}
            fill={props.colors.get(part.provider)}
            data-dim={props.active !== null && props.active !== part.provider ? "" : undefined}
            onPointerEnter={() => props.onActive(part.provider)}
            onPointerLeave={() => props.onActive(null)}
          />
        );
      })}
    </svg>
  );
}

/**
 * Spend by Provider: where this month's all-in money goes. A ring for the share at a glance, and a table that says
 * what kind of money it is (plans, usage, top-ups) per provider, so nothing hides behind a toggle.
 */
export function SpendByProvider(props: { readonly summary: WalletSummary }) {
  const { summary } = props;
  const [active, setActive] = useState<string | null>(null);
  const headingId = useId();
  const currency: Currency = summary.currency;
  const parts = providerSpend(summary);
  const all = parts.reduce((sum, part) => sum + part.total, 0);
  const largest = parts.reduce((max, part) => Math.max(max, part.total), 0);
  const colors = new Map(
    parts.map((part, index) => [part.provider, `var(--series-${String(Math.min(index + 1, 7))})`]),
  );
  const money = (minor: number): string => formatMoney({ minor, currency });
  const cell = (minor: number) =>
    minor > 0 ? <td className="num">{money(minor)}</td> : <td className="num muted">—</td>;
  const focus = parts.find((part) => part.provider === active);
  const unpaid = summary.counts.free + summary.counts.included;
  const footer = [
    all === 0 ? null : `Per year at this rate ${money(Math.round(all * 12))}`,
    unpaid === 0
      ? null
      : `${plural(unpaid, "free or included account", "free or included accounts")} not shown`,
    summary.allIn.missing === 0
      ? null
      : `${plural(summary.allIn.missing, "amount", "amounts")} without a rate left out`,
  ].filter((part) => part !== null);

  return (
    <section className="w-spend" aria-labelledby={headingId}>
      <div className="w-card">
        <header className="w-card-head">
          <h2 id={headingId}>Spend by Provider</h2>
          <span className="muted">This month · all-in</span>
        </header>
        {parts.length === 0 ? (
          <div className="sp-body">
            <p className="w-spend-empty muted">Nothing paid this month yet.</p>
          </div>
        ) : (
          <div className="sp-body">
            <div className="sp-chart">
              <Ring parts={parts} colors={colors} active={active} onActive={setActive} />
              <div className="sp-center" aria-hidden="true">
                <span className="sp-center-label">
                  {focus === undefined ? "All-in this month" : providerName(focus.provider)}
                </span>
                <span className="sp-center-value num">
                  {money(focus === undefined ? all : focus.total)}
                </span>
                <span className="sp-center-meta">
                  {focus === undefined
                    ? plural(parts.length, "provider paying", "providers paying")
                    : `${shareFormat.format((focus.total / all) * 100)}% of all-in`}
                </span>
              </div>
            </div>
            <table className="sp-table">
              <caption className="sr">Where this month's money goes, by provider</caption>
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col" className="sp-mix-head" aria-label="Mix">
                    <span className="sp-keys">
                      <span className="sp-key">
                        <i data-kind="plan" />
                        Plan
                      </span>
                      <span className="sp-key">
                        <i data-kind="usage" />
                        Usage
                      </span>
                      <span className="sp-key">
                        <i data-kind="topup" />
                        Top-ups
                      </span>
                    </span>
                  </th>
                  <th scope="col" className="sp-n">
                    Plan
                  </th>
                  <th scope="col" className="sp-n">
                    Usage
                  </th>
                  <th scope="col" className="sp-n">
                    Top-ups
                  </th>
                  <th scope="col">Total</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((part) => (
                  <tr
                    key={part.provider}
                    data-on={active === part.provider ? "" : undefined}
                    data-dim={active !== null && active !== part.provider ? "" : undefined}
                    onPointerEnter={() => setActive(part.provider)}
                    onPointerLeave={() => setActive(null)}
                  >
                    <th scope="row">
                      <span className="sp-who">
                        <i className="sp-dot" style={{ background: colors.get(part.provider) }} />
                        <BrandMark provider={part.provider} />
                        {providerName(part.provider)}
                      </span>
                    </th>
                    <td className="sp-mix" aria-hidden="true">
                      {/* Bars share one scale, so a row's length is its total against the largest provider. */}
                      <span
                        className="sp-stack"
                        style={{ width: `${(part.total / largest) * 100}%` }}
                      >
                        {part.plan > 0 ? (
                          <i
                            data-kind="plan"
                            style={{ flexGrow: part.plan, color: colors.get(part.provider) }}
                          />
                        ) : null}
                        {part.usage > 0 ? (
                          <i
                            data-kind="usage"
                            style={{ flexGrow: part.usage, color: colors.get(part.provider) }}
                          />
                        ) : null}
                        {part.topUps > 0 ? (
                          <i
                            data-kind="topup"
                            style={{ flexGrow: part.topUps, color: colors.get(part.provider) }}
                          />
                        ) : null}
                      </span>
                    </td>
                    {cell(part.plan)}
                    {cell(part.usage)}
                    {cell(part.topUps)}
                    <td className="num sp-total">{money(part.total)}</td>
                    <td className="num sp-share">
                      {shareFormat.format((part.total / all) * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {footer.length === 0 ? null : <p className="w-card-foot muted">{footer.join(" · ")}</p>}
      </div>
    </section>
  );
}
