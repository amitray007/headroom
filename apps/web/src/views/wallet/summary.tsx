import { Children, isValidElement, type ReactNode } from "react";

import { BrandMark, ChevronDownIcon } from "../../icons.tsx";
import { accountName, providerName } from "@headroom/view-model/labels";
import type { OverviewConnection } from "@headroom/view-model/overview";
import { dayLabel, monthLong } from "@headroom/view-model/wallet-dates";
import { formatMoney } from "@headroom/view-model/wallet-money";
import type { WalletSummary, WalletTopUp } from "@headroom/view-model/wallet";

import { Pill } from "../../ui/pill.tsx";
import { Popover } from "../../ui/menu.tsx";
import { figureText, originalNote } from "./amount.ts";
import { Attention } from "./attention.tsx";
import {
  subscriptionIssues,
  topUpIssues,
  usageIssues,
  type AttentionFixes,
} from "./attention-items.ts";

/** One caption part. */
function Line(props: { readonly children: ReactNode }) {
  return <span>{props.children}</span>;
}

function Stat(props: {
  readonly label: string;
  /** The figure. `null` shows a dash: nothing to show is unknown, not zero. */
  readonly value: string | null;
  /** What shows in place of a missing figure. */
  readonly empty?: string;
  readonly unit?: string;
  /** The attention icon beside the label, when the figure leaves something out. */
  readonly attention?: ReactNode;
  /** Short parts of the caption under the figure; a dot splits them. */
  readonly children: ReactNode;
}) {
  const { value } = props;
  // `Children.toArray` drops null parts, so a part that renders nothing never leaves a dot behind.
  const caption: ReactNode[] = Children.toArray(props.children).flatMap<ReactNode>((part, index) =>
    index === 0 || !isValidElement(part)
      ? [part]
      : [
          // `Children.toArray` gave the part a stable key; the dot before it borrows it.
          <span key={`sep-${part.key}`} className="w-sep" aria-hidden="true">
            ·
          </span>,
          part,
        ],
  );
  return (
    <div className="w-stat">
      <dt>
        <span>{props.label}</span>
        {props.attention}
      </dt>
      <dd className={value === null ? "w-num unknown" : "w-num"}>
        {value ?? props.empty ?? "—"}
        {props.unit === undefined || value === null ? null : (
          <span className="unit">{props.unit}</span>
        )}
      </dd>
      <dd className="w-cap">{caption}</dd>
    </div>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One top-up: provider and account, date and credits, then the amount with what was billed beneath it. */
function TopUpRow(props: {
  readonly topUp: WalletTopUp;
  readonly connection: OverviewConnection | undefined;
}) {
  const { topUp, connection } = props;
  const note = topUp.amount === null ? null : originalNote(topUp.amount, " billed");
  const detail = [
    dayLabel(topUp.date),
    topUp.credits === null ? null : `${topUp.credits.toLocaleString("en-US")} credits`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const who = connection === undefined ? null : accountName(connection);
  return (
    <li>
      {connection === undefined ? <span /> : <BrandMark provider={connection.provider} />}
      <span className="w-pop-text">
        <span className="w-pop-name">
          {connection === undefined ? (
            "Removed account"
          ) : (
            <>
              {providerName(connection.provider)}
              {who === null ? null : (
                <>
                  {" · "}
                  <span className={who.includes("@") ? "who" : undefined}>{who}</span>
                </>
              )}
            </>
          )}
        </span>
        <span className="w-pop-sub">{detail}</span>
      </span>
      <span className="w-pop-amount num">
        {topUp.kind === "free" ? (
          <Pill tone="quiet">Free</Pill>
        ) : topUp.amount === null ? (
          <span className="w-pop-sub">Price not set</span>
        ) : (
          <span className="w-pop-name">{figureText(topUp.amount)}</span>
        )}
        {note === null ? null : <span className="w-pop-sub">{note}</span>}
      </span>
    </li>
  );
}

/** This month's top-ups in a popover: the month and a count, a row per top-up, then the paid total. */
function TopUpsPopover(props: {
  readonly summary: WalletSummary;
  readonly connections: ReadonlyMap<string, OverviewConnection>;
  readonly caption: string;
}) {
  const { items, paid, paidCount, unpriced } = props.summary.topUpsThisMonth;
  return (
    <Popover
      label={`Top-ups this month: ${props.caption}`}
      panelLabel="Top-ups this month"
      panelClassName="notif w-topups-pop"
      triggerClassName="w-cap-trigger"
      // The caption sits at the left of its column, so the panel opens rightward and never covers the next stat.
      align="start"
      trigger={
        <>
          {props.caption}
          <ChevronDownIcon />
        </>
      }
      openOnHover
    >
      <p className="w-pop-head">
        <span>{monthLong(props.summary.today.slice(0, 7))}</span>
        <span>{plural(items.length, "top-up", "top-ups")}</span>
      </p>
      <ul className="w-pop-list">
        {items.map((topUp) => (
          <TopUpRow
            key={topUp.id}
            topUp={topUp}
            connection={props.connections.get(topUp.connectionId)}
          />
        ))}
      </ul>
      <p className="w-pop-total">
        {paidCount === 0 ? (
          <span>No paid top-ups</span>
        ) : (
          <>
            <span>Total paid</span>
            <span className="num">{formatMoney(paid.money)}</span>
          </>
        )}
      </p>
      {paid.missing === 0 ? null : (
        <p className="w-pop-note">{plural(paid.missing, "amount has", "amounts have")} no rate.</p>
      )}
      {unpriced === 0 ? null : (
        <p className="w-pop-note">
          {plural(unpriced, "top-up has", "top-ups have")} no price yet and{" "}
          {unpriced === 1 ? "is" : "are"} left out of the total.
        </p>
      )}
    </Popover>
  );
}

/** Usage spend by account in a popover, like the top-ups one: who, what the provider reports, how much, then the total. */
function UsageSpendPopover(props: { readonly summary: WalletSummary; readonly caption: string }) {
  const accounts = props.summary.providers
    .flatMap((provider) => provider.accounts)
    .flatMap((account) =>
      // A reported zero adds nothing to the breakdown; an amount with no rate still shows, marked.
      account.usageSpend === null || account.usageSpend.shown?.minor === 0
        ? []
        : [{ connection: account.connection, spend: account.usageSpend }],
    )
    .toSorted((a, b) => (b.spend.shown?.minor ?? 0) - (a.spend.shown?.minor ?? 0));
  const { usageSpend } = props.summary;
  return (
    <Popover
      label={`Usage spend: ${props.caption}`}
      panelLabel="Usage spend by account"
      panelClassName="notif w-topups-pop"
      triggerClassName="w-cap-trigger"
      align="start"
      trigger={
        <>
          {props.caption}
          <ChevronDownIcon />
        </>
      }
      openOnHover
    >
      <p className="w-pop-head">
        <span>Reported by the provider</span>
        <span>{plural(accounts.length, "account", "accounts")}</span>
      </p>
      <ul className="w-pop-list">
        {accounts.map(({ connection, spend }) => {
          const who = accountName(connection);
          const note = originalNote(spend, "");
          return (
            <li key={connection.id}>
              <BrandMark provider={connection.provider} />
              <span className="w-pop-text">
                <span className="w-pop-name">
                  {providerName(connection.provider)}
                  {" · "}
                  <span className={who.includes("@") ? "who" : undefined}>{who}</span>
                </span>
                <span className="w-pop-sub">{spend.label}</span>
              </span>
              <span className="w-pop-amount num">
                <span className="w-pop-name">{figureText(spend)}</span>
                {note === null ? null : <span className="w-pop-sub">{note}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="w-pop-total">
        <span>Total</span>
        <span className="num">{formatMoney(usageSpend.money)}</span>
      </p>
      {usageSpend.missing === 0 ? null : (
        <p className="w-pop-note">
          {plural(usageSpend.missing, "amount has", "amounts have")} no rate.
        </p>
      )}
    </Popover>
  );
}

/** The four stats in one bordered group, split by hairlines. */
export function SummaryBand(
  props: AttentionFixes & {
    readonly summary: WalletSummary;
    readonly connections: readonly OverviewConnection[];
  },
) {
  const { summary } = props;
  const byId = new Map(props.connections.map((connection) => [connection.id, connection]));
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

  const subscriptions = subscriptionIssues(summary, props);
  const usage = usageIssues(summary);
  const topUpItems = topUpIssues(summary, byId, props);

  return (
    <dl className="w-band">
      {priced ? (
        <Stat
          label="Subscriptions"
          value={formatMoney(summary.monthly.money)}
          unit="/ month"
          attention={<Attention title="Subscriptions" items={subscriptions} />}
        >
          <Line>{counts.paid === 0 ? "None paid" : `${counts.paid} paid`}</Line>
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
        <Stat
          label="Usage Spend"
          value={formatMoney(summary.usageSpend.money)}
          attention={<Attention title="Usage Spend" items={usage} />}
        >
          <UsageSpendPopover
            summary={summary}
            caption={`From ${plural(spenders, "provider", "providers")}`}
          />
        </Stat>
      )}
      <Stat
        label="Top-Ups This Month"
        value={formatMoney(topUps.paid.money)}
        attention={<Attention title="Top-Ups This Month" items={topUpItems} />}
      >
        {topUps.items.length === 0 ? (
          <Line>None this month</Line>
        ) : (
          <TopUpsPopover summary={summary} connections={byId} caption={topUpCaption} />
        )}
      </Stat>
      <Stat
        label="All-In This Month"
        value={formatMoney(summary.allIn.money)}
        attention={
          <Attention
            title="All-In This Month"
            items={[...(priced ? subscriptions : []), ...usage, ...topUpItems]}
          />
        }
      >
        <Line>Plans, usage and top-ups</Line>
      </Stat>
    </dl>
  );
}
