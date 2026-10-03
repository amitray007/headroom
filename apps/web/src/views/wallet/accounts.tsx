import { useId } from "react";

import { BrandMark, PencilIcon, PlusIcon } from "../../icons.tsx";
import { accountName, planLabel, providerName } from "@headroom/view-model/labels";
import { dayLabel } from "@headroom/view-model/wallet-dates";
import { formatMoney } from "@headroom/view-model/wallet-money";
import type { WalletAccount, WalletProvider } from "@headroom/view-model/wallet";

import { Button } from "../../ui/button.tsx";
import { Pill } from "../../ui/pill.tsx";
import { figureText, originalNote } from "./amount.ts";

/** What the account costs per month: a price, Free, Included, or Not Set. */
function CostCell(props: { readonly account: WalletAccount }) {
  const { cost, monthly, billed } = props.account;
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
  if (monthly === null || billed === null) return null;
  const yearly = cost.cycle === "annual" ? (billed.original ?? billed.shown) : null;
  const notes: string[] = [];
  // No rate: say so. A yearly plan names its yearly price; a monthly one names what it was converted from.
  if (monthly.shown === null) notes.push(originalNote(monthly) ?? "");
  if (yearly !== null) notes.push(`${formatMoney(yearly)} / year`);
  else if (monthly.shown !== null) notes.push(originalNote(monthly, " billed") ?? "");
  return (
    <span className="w-cost">
      <span className="w-figure num">{figureText(monthly)}</span>
      {notes
        .filter((note) => note !== "")
        .map((note) => (
          <span key={note} className="muted num">
            {note}
          </span>
        ))}
    </span>
  );
}

/** Usage spend the provider reports: the figure alone, with what it is in the tooltip. */
function SpendCell(props: { readonly account: WalletAccount }) {
  const { usageSpend } = props.account;
  if (usageSpend === null) return null;
  const note = originalNote(usageSpend);
  return (
    <span className="w-cost" title={usageSpend.label}>
      <span className="w-figure num">{figureText(usageSpend)}</span>
      {note === null ? null : <span className="muted num">{note}</span>}
    </span>
  );
}

function AccountRow(props: {
  readonly account: WalletAccount;
  readonly onEdit: () => void;
  readonly onAddTopUp: () => void;
}) {
  const { account } = props;
  const { connection, nextRenewal } = account;
  const name = accountName(connection);
  const plan = planLabel(connection.plan);
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
      </div>
      <div className="w-col w-c-cost" data-label="Cost / Month">
        <CostCell account={account} />
      </div>
      <div className="w-col w-c-renew" data-label="Renews">
        {nextRenewal === null ? (
          <span className="muted">—</span>
        ) : (
          <span>{dayLabel(nextRenewal)}</span>
        )}
      </div>
      <div className="w-col w-c-spend" data-label="Usage Spend">
        <SpendCell account={account} />
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
        <Button
          variant="quiet"
          size="sm"
          aria-label={`Add top-up for ${name}`}
          title="Add Top-Up"
          onClick={props.onAddTopUp}
        >
          <PlusIcon />
        </Button>
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

/** One provider: its header with the monthly subtotal, a column header row, then a row per account. */
export function ProviderBlock(props: {
  readonly group: WalletProvider;
  readonly onEdit: (connectionId: string) => void;
  readonly onAddTopUp: (connectionId: string) => void;
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
      <div className="w-card">
        <div className="w-colhead">
          <span>Account</span>
          <span>Cost / Month</span>
          <span>Renews</span>
          <span>Usage Spend</span>
          <span />
        </div>
        <ul className="w-rows">
          {group.accounts.map((account) => (
            <AccountRow
              key={account.connection.id}
              account={account}
              onEdit={() => props.onEdit(account.connection.id)}
              onAddTopUp={() => props.onAddTopUp(account.connection.id)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}
