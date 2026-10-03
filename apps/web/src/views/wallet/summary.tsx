import type { ReactNode } from "react";

import { BrandMark, ChevronDownIcon } from "../../icons.tsx";
import { accountName, planLabel, providerName } from "@headroom/view-model/labels";
import type { OverviewConnection } from "@headroom/view-model/overview";
import { dayLabel } from "@headroom/view-model/wallet-dates";
import { formatMoney } from "@headroom/view-model/wallet-money";
import type { Total, WalletSummary } from "@headroom/view-model/wallet";

import { Pill } from "../../ui/pill.tsx";
import { Popover } from "../../ui/menu.tsx";
import { figureText, originalNote } from "./amount.ts";

/** One caption line. `warn` is the quiet amber line for something that needs the owner. */
function Line(props: { readonly warn?: boolean; readonly children: ReactNode }) {
  return <span className={props.warn === true ? "warn" : undefined}>{props.children}</span>;
}

function Stat(props: {
  readonly label: string;
  /** The figure. `null` shows a dash: nothing to show is unknown, not zero. */
  readonly value: string | null;
  /** What shows in place of a missing figure. */
  readonly empty?: string;
  readonly unit?: string;
  /** Short lines under the figure; each stays on one line. */
  readonly children: ReactNode;
}) {
  const { value } = props;
  return (
    <div className="w-stat">
      <dt>{props.label}</dt>
      <dd className={value === null ? "w-num unknown" : "w-num"}>
        {value ?? props.empty ?? "—"}
        {props.unit === undefined || value === null ? null : (
          <span className="unit">{props.unit}</span>
        )}
      </dd>
      <dd className="w-cap">{props.children}</dd>
    </div>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The warning line for amounts a missing rate kept out of a total, or nothing. */
function LeftOut(props: { readonly total: Total }) {
  const { missing } = props.total;
  return missing === 0 ? null : (
    <Line warn>{plural(missing, "amount has", "amounts have")} no rate</Line>
  );
}

/** This month's top-ups in a popover: who, when, and what it cost, then the paid total. */
function TopUpsPopover(props: {
  readonly summary: WalletSummary;
  readonly connections: ReadonlyMap<string, OverviewConnection>;
  readonly caption: string;
}) {
  const { items, paid } = props.summary.topUpsThisMonth;
  return (
    <Popover
      label={`Top-ups this month: ${props.caption}`}
      panelLabel="Top-ups this month"
      panelClassName="notif w-topups-pop"
      triggerClassName="w-cap-trigger"
      trigger={
        <>
          {props.caption}
          <ChevronDownIcon />
        </>
      }
      openOnHover
    >
      <h2 className="w-pop-title">Top-Ups This Month</h2>
      <ul className="w-pop-list">
        {items.map((topUp) => {
          const connection = props.connections.get(topUp.connectionId);
          const note = topUp.amount === null ? null : originalNote(topUp.amount);
          return (
            <li key={topUp.id}>
              {connection === undefined ? <span /> : <BrandMark provider={connection.provider} />}
              <span className="w-pop-name">
                {connection === undefined
                  ? "Removed account"
                  : `${providerName(connection.provider)} · ${accountName(connection)}`}
              </span>
              <span className="muted num">{dayLabel(topUp.date)}</span>
              <span className="w-pop-paid num">
                {topUp.amount === null ? (
                  <Pill tone="quiet">Free</Pill>
                ) : (
                  <>
                    <span className="muted">Paid </span>
                    {figureText(topUp.amount)}
                  </>
                )}
                {note === null ? null : <span className="muted"> · {note}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="w-pop-total">
        <span>Paid total</span>
        <span className="num">{formatMoney(paid.money)}</span>
      </p>
      {paid.missing === 0 ? null : (
        <p className="w-pop-note muted">
          {plural(paid.missing, "amount has", "amounts have")} no rate.
        </p>
      )}
    </Popover>
  );
}

/** The four stats in one bordered group, split by hairlines. */
export function SummaryBand(props: {
  readonly summary: WalletSummary;
  readonly connections: readonly OverviewConnection[];
}) {
  const { summary } = props;
  const byId = new Map(props.connections.map((connection) => [connection.id, connection]));
  const accounts = summary.providers.flatMap((provider) => provider.accounts);
  const { counts } = summary;
  const priced = counts.paid + counts.free + counts.included > 0;

  const spenders = summary.providers.filter((provider) =>
    provider.accounts.some((account) => account.usageSpend !== null),
  ).length;

  const topUps = summary.topUpsThisMonth;
  const topUpCaption = [
    topUps.paidCount > 0 ? `${topUps.paidCount} paid` : null,
    topUps.freeCount > 0 ? `${topUps.freeCount} free` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");

  const next = summary.nextRenewal;
  const renewing =
    next === null
      ? undefined
      : accounts.find((account) => account.connection.id === next.connectionId);
  const renewingName =
    renewing === undefined
      ? null
      : `${providerName(renewing.connection.provider)} ${planLabel(renewing.connection.plan) ?? accountName(renewing.connection)}`;
  const nextPrice = next === null ? null : figureText(next.price);

  return (
    <dl className="w-band">
      {priced ? (
        <Stat label="Subscriptions" value={formatMoney(summary.monthly.money)} unit="/ month">
          <Line>
            {counts.paid === 0
              ? "No paid subscriptions"
              : plural(counts.paid, "paid subscription", "paid subscriptions")}
          </Line>
          {counts.notSet === 0 ? null : (
            <Line warn>{plural(counts.notSet, "account", "accounts")} not priced</Line>
          )}
          <LeftOut total={summary.monthly} />
        </Stat>
      ) : (
        <Stat label="Subscriptions" value={null} empty="Not Set">
          <Line>Set a cost on each account</Line>
        </Stat>
      )}
      {spenders === 0 ? (
        <Stat label="Usage Spend" value={null}>
          <Line>No account reports spend</Line>
        </Stat>
      ) : (
        <Stat label="Usage Spend" value={formatMoney(summary.usageSpend.money)}>
          <Line>From {plural(spenders, "provider", "providers")}</Line>
          <LeftOut total={summary.usageSpend} />
        </Stat>
      )}
      <Stat label="Top-Ups This Month" value={formatMoney(topUps.paid.money)}>
        {topUps.items.length === 0 ? (
          <Line>None this month</Line>
        ) : (
          <TopUpsPopover summary={summary} connections={byId} caption={topUpCaption} />
        )}
        <LeftOut total={topUps.paid} />
      </Stat>
      <Stat label="Next Renewal" value={next === null ? null : dayLabel(next.date)}>
        <Line>
          {next === null
            ? "No renewal date set"
            : renewingName === null
              ? nextPrice
              : `${renewingName} · ${nextPrice}`}
        </Line>
      </Stat>
    </dl>
  );
}
