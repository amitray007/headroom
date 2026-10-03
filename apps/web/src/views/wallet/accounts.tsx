import { useId } from "react";

import { BrandMark, PencilIcon } from "../../icons.tsx";
import { accountName, planLabel, providerName } from "@headroom/view-model/labels";
import {
  convert,
  formatMoney,
  type Currency,
  type Cycle,
  type WalletAccount,
  type WalletBook,
  type WalletProvider,
} from "@headroom/view-model/wallet";

import { Button } from "../../ui/button.tsx";
import { Pill } from "../../ui/pill.tsx";
import { dayLabel, plural } from "./book.ts";

const cycleWord: Record<Cycle, string> = { monthly: "month", annual: "year" };

function Price(props: { readonly text: string; readonly unit: string }) {
  return (
    <span className="w-price">
      <span className="num">{props.text}</span>
      <span className="unit">{props.unit}</span>
    </span>
  );
}

/** What the account costs: a price, Free, Included, or Not Set. */
function CostCell(props: { readonly account: WalletAccount }) {
  const { cost, monthly } = props.account;
  if (cost === null) return <span className="w-unset">Not Set</span>;
  if (cost.kind === "free") return <Pill tone="quiet">Free</Pill>;
  if (cost.kind === "included") {
    return (
      <span className="w-included">
        <Pill tone="quiet">Included</Pill>
        <span className="muted">with {cost.includedWith}</span>
      </span>
    );
  }
  return (
    <span className="w-cost">
      <Price text={formatMoney(cost.price)} unit={`/ ${cycleWord[cost.cycle]}`} />
      {cost.cycle === "annual" && monthly !== null ? (
        <span className="muted num">{formatMoney(monthly)} / month</span>
      ) : null}
    </span>
  );
}

/** The next renewal, and for a price in another currency what it comes to in the display currency. */
function RenewalCell(props: {
  readonly account: WalletAccount;
  readonly display: Currency;
  readonly perUsd: WalletBook["perUsd"];
}) {
  const { cost, nextRenewal } = props.account;
  if (cost === null || cost.kind !== "paid") return <span className="muted">—</span>;
  const converted =
    cost.price.currency === props.display ? null : convert(cost.price, props.display, props.perUsd);
  return (
    <span className="w-renewal">
      {nextRenewal === null ? (
        <span className="muted">—</span>
      ) : (
        <span>Renews {dayLabel(nextRenewal)}</span>
      )}
      {cost.price.currency === props.display ? null : converted === null ? (
        <span className="muted">No exchange rate</span>
      ) : (
        <span className="muted num">≈ {formatMoney(converted)}</span>
      )}
    </span>
  );
}

/** "2 top-ups · $25 paid · 1 free", or null when the account has none. */
function topUpLine(
  account: WalletAccount,
  display: Currency,
  perUsd: WalletBook["perUsd"],
): string | null {
  const { topUps } = account;
  if (topUps.length === 0) return null;
  const paid = topUps.filter((topUp) => topUp.kind === "paid");
  const free = topUps.length - paid.length;
  const parts = [plural(topUps.length, "top-up", "top-ups")];
  if (paid.length > 0) {
    // One amount with no rate leaves the total unknown, so only the count shows.
    let minor = 0;
    let known = true;
    for (const topUp of paid) {
      const money = topUp.price === null ? null : convert(topUp.price, display, perUsd);
      if (money === null) known = false;
      else minor += money.minor;
    }
    parts.push(known ? `${formatMoney({ minor, currency: display })} paid` : `${paid.length} paid`);
  }
  if (free > 0) parts.push(`${free} free`);
  return parts.join(" · ");
}

function AccountRow(props: {
  readonly account: WalletAccount;
  readonly display: Currency;
  readonly perUsd: WalletBook["perUsd"];
  readonly onEdit: () => void;
}) {
  const { account } = props;
  const { connection, usageSpend } = account;
  const name = accountName(connection);
  const plan = planLabel(connection.plan);
  const line = topUpLine(account, props.display, props.perUsd);
  return (
    <li className="w-row">
      <div className="w-who">
        <span className="w-name">
          {name}
          {plan === null ? null : (
            <span className="plan">
              <span className="sep" aria-hidden="true">
                ·
              </span>
              {plan}
            </span>
          )}
        </span>
        {connection.identity === null ? null : (
          <span className="w-sub who">{connection.identity}</span>
        )}
        {line === null ? null : <span className="w-sub">{line}</span>}
      </div>
      <div className="w-col w-c-cost">
        <CostCell account={account} />
      </div>
      <div className="w-col w-c-renew">
        <RenewalCell account={account} display={props.display} perUsd={props.perUsd} />
      </div>
      <div className="w-col w-c-spend">
        {usageSpend === null ? null : (
          <span className="w-spend">
            <span className="num">+{formatMoney(usageSpend.money)}</span>
            <span className="muted">{usageSpend.label}</span>
          </span>
        )}
      </div>
      <div className="w-act">
        {account.cost === null ? (
          <Button variant="quiet" size="sm" onClick={props.onEdit}>
            Set Cost
          </Button>
        ) : (
          <Button
            variant="quiet"
            size="sm"
            aria-label={`Edit cost of ${name}`}
            onClick={props.onEdit}
          >
            <PencilIcon />
          </Button>
        )}
      </div>
    </li>
  );
}

/** The provider's monthly subtotal: "$300 / month", or Not Set when no account has a cost. */
function Subtotal(props: { readonly group: WalletProvider }) {
  const { group } = props;
  if (group.accounts.every((account) => account.cost === null)) {
    return <span className="w-subtotal muted">Not set</span>;
  }
  return (
    <span className="w-subtotal">
      <span className="num">{formatMoney(group.monthly.money)}</span>
      <span className="muted"> / month</span>
      {group.monthly.missing > 0 ? (
        <span className="muted"> · {group.monthly.missing} left out</span>
      ) : null}
    </span>
  );
}

/** One provider: its header with the monthly subtotal, then one bordered group with a row per account. */
export function ProviderBlock(props: {
  readonly group: WalletProvider;
  readonly display: Currency;
  readonly perUsd: WalletBook["perUsd"];
  readonly onEdit: (connectionId: string) => void;
}) {
  const { group } = props;
  const headingId = useId();
  return (
    <section
      className="provider w-provider"
      data-accent={group.provider}
      aria-labelledby={headingId}
    >
      <header>
        <BrandMark provider={group.provider} />
        <h2 id={headingId}>{providerName(group.provider)}</h2>
        {group.accounts.length > 1 ? (
          <span className="chip count">{group.accounts.length} Accounts</span>
        ) : null}
        <Subtotal group={group} />
      </header>
      <ul className="w-card">
        {group.accounts.map((account) => (
          <AccountRow
            key={account.connection.id}
            account={account}
            display={props.display}
            perUsd={props.perUsd}
            onEdit={() => props.onEdit(account.connection.id)}
          />
        ))}
      </ul>
    </section>
  );
}
