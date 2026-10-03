import { useId, type ReactNode } from "react";

import { BrandMark, ChevronDownIcon } from "../../icons.tsx";
import type { OverviewConnection } from "@headroom/view-model/overview";
import { daysBetween, dueIn, monthName } from "@headroom/view-model/wallet-dates";
import { formatMoney } from "@headroom/view-model/wallet-money";
import {
  renewalWindowDays,
  topUpMonthCount,
  type Renewal,
  type WalletSummary,
} from "@headroom/view-model/wallet";

import { Popover } from "../../ui/menu.tsx";
import { SparkBars, type SparkBar } from "../../ui/spark-bars.tsx";
import { figureText, renewalName } from "./amount.ts";

/** How many upcoming renewals the card lists; the footer opens the rest in a popover. */
const listed = 4;

/** A small card in the Wallet's card style: a header with a muted note, a body, and an optional footer. */
function GlanceCard(props: {
  readonly title: string;
  readonly note: string;
  readonly footer?: ReactNode;
  /** Lay the footer out as a left part and a right-aligned figure (its children are two nodes). */
  readonly split?: boolean;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className="w-glance-card" aria-labelledby={headingId}>
      <div className="w-card">
        <header className="w-card-head">
          <h2 id={headingId}>{props.title}</h2>
          <span className="muted">{props.note}</span>
        </header>
        <div className="w-card-body">{props.children}</div>
        {props.footer === undefined ? null : (
          <div className={props.split === true ? "w-card-foot split muted" : "w-card-foot muted"}>
            {props.footer}
          </div>
        )}
      </div>
    </section>
  );
}

/** Paid top-ups per month for the last six months, this month emphasised, with the window's total beneath. */
export function TopUpsCard(props: { readonly summary: WalletSummary }) {
  const { topUpMonths, topUps, currency } = props.summary;
  const months = new Set(topUpMonths.map((entry) => entry.month));
  const inWindow = topUps.filter((topUp) => months.has(topUp.date.slice(0, 7)));
  const free = inWindow.filter((topUp) => topUp.kind === "free").length;
  const minor = topUpMonths.reduce((sum, entry) => sum + entry.paid.money.minor, 0);
  const missing = topUpMonths.reduce((sum, entry) => sum + entry.paid.missing, 0);
  const note = `Last ${topUpMonthCount} months`;
  if (inWindow.length === 0) {
    return (
      <GlanceCard title="Top-Ups" note={note}>
        <p className="w-spend-empty muted">No top-ups yet.</p>
      </GlanceCard>
    );
  }
  const bars = topUpMonths.map((entry, index): SparkBar => ({
    key: entry.month,
    label: monthName(entry.month),
    value: entry.paid.money.minor,
    display: formatMoney(entry.paid.money),
    active: index === topUpMonths.length - 1,
  }));
  const footer = [
    `Total ${formatMoney({ minor, currency })}`,
    free === 0 ? null : `${free} free`,
    missing === 0 ? null : `${missing} without rate`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <GlanceCard title="Top-Ups" note={note} footer={footer}>
      <SparkBars label={`Paid top-ups per month, ${note.toLowerCase()}`} bars={bars} height={120} />
    </GlanceCard>
  );
}

interface RenewalItem {
  readonly renewal: Renewal;
  readonly connection: OverviewConnection;
}

/** One renewal: a calendar tile, the plan, how far away it is, and the amount. The card and its popover share it. */
function RenewalRow(props: { readonly item: RenewalItem; readonly today: string }) {
  const { renewal, connection } = props.item;
  const days = daysBetween(props.today, renewal.date) ?? 0;
  return (
    <li className={days <= 2 ? "soon" : undefined}>
      <span className="w-day-tile">
        <b className="num">{Number(renewal.date.slice(8, 10))}</b>
        <span>{monthName(renewal.date.slice(0, 7))}</span>
      </span>
      <BrandMark provider={connection.provider} />
      <span className="w-renewal-text">
        <span className="w-renewal-name">{renewalName(connection)}</span>
        <span className="w-renewal-when">{dueIn(days)}</span>
      </span>
      <span className="w-renewal-amount num">{figureText(renewal.price)}</span>
    </li>
  );
}

/** "2 more renewals" opening the rest of the list, with what they come to on the right. */
function MoreRenewals(props: {
  readonly items: readonly RenewalItem[];
  readonly today: string;
  readonly total: string;
}) {
  const caption = `${props.items.length} more ${props.items.length === 1 ? "renewal" : "renewals"}`;
  return (
    <>
      <Popover
        label={caption}
        panelLabel="More upcoming renewals"
        panelClassName="notif w-renewals-pop"
        triggerClassName="w-cap-trigger"
        // The trigger sits at the left of the footer, so the panel opens rightward.
        align="start"
        trigger={
          <>
            {caption}
            <ChevronDownIcon />
          </>
        }
        openOnHover
      >
        <ul className="w-renewals">
          {props.items.map((item) => (
            <RenewalRow key={item.renewal.connectionId} item={item} today={props.today} />
          ))}
        </ul>
      </Popover>
      <span className="num">{props.total}</span>
    </>
  );
}

/**
 * The renewals due in the next 30 days, soonest first: a calendar tile, the plan, how far away it is, and the
 * amount. The header totals what falls due in the window; the footer opens the ones past the first few.
 */
export function RenewalsCard(props: {
  readonly summary: WalletSummary;
  readonly connections: readonly OverviewConnection[];
}) {
  const { summary } = props;
  const byId = new Map(props.connections.map((connection) => [connection.id, connection]));
  const items = summary.renewals.flatMap((renewal): RenewalItem[] => {
    const connection = byId.get(renewal.connectionId);
    return connection === undefined ? [] : [{ renewal, connection }];
  });
  const window = `Next ${renewalWindowDays} days`;
  if (items.length === 0) {
    return (
      <GlanceCard title="Upcoming Renewals" note={window}>
        <p className="w-spend-empty muted">No renewals in the next {renewalWindowDays} days</p>
      </GlanceCard>
    );
  }
  const shownTotal = (list: readonly RenewalItem[]): string =>
    formatMoney({
      minor: list.reduce((sum, { renewal }) => sum + (renewal.price.shown?.minor ?? 0), 0),
      currency: summary.currency,
    });
  const rest = items.slice(listed);
  return (
    <GlanceCard
      title="Upcoming Renewals"
      note={`${shownTotal(items)} in ${renewalWindowDays} days`}
      split
      footer={
        rest.length === 0 ? undefined : (
          <MoreRenewals items={rest} today={summary.today} total={shownTotal(rest)} />
        )
      }
    >
      <ul className="w-renewals">
        {items.slice(0, listed).map((item) => (
          <RenewalRow key={item.renewal.connectionId} item={item} today={summary.today} />
        ))}
      </ul>
    </GlanceCard>
  );
}
