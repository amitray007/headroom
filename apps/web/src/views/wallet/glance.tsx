import { useId, type ReactNode } from "react";

import { BrandMark } from "../../icons.tsx";
import type { OverviewConnection } from "@headroom/view-model/overview";
import { dayLabel, monthName } from "@headroom/view-model/wallet-dates";
import { formatMoney } from "@headroom/view-model/wallet-money";
import {
  renewalWindowDays,
  topUpMonthCount,
  type WalletSummary,
} from "@headroom/view-model/wallet";

import { DayStrip, type DayMark } from "../../ui/day-strip.tsx";
import { SparkBars, type SparkBar } from "../../ui/spark-bars.tsx";
import { figureText, renewalName } from "./amount.ts";

/** How many upcoming renewals the card lists under the strip. */
const listed = 3;

/** A small card in the Wallet's card style: a header with a muted note, a body, and an optional footer. */
function GlanceCard(props: {
  readonly title: string;
  readonly note: string;
  readonly footer?: ReactNode;
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
        {props.footer === undefined ? null : <p className="w-card-foot muted">{props.footer}</p>}
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
      <SparkBars label={`Paid top-ups per month, ${note.toLowerCase()}`} bars={bars} height={64} />
    </GlanceCard>
  );
}

/** The next 30 days as a strip of dots, then the next few renewals as rows. */
export function RenewalsCard(props: {
  readonly summary: WalletSummary;
  readonly connections: readonly OverviewConnection[];
}) {
  const { summary } = props;
  const byId = new Map(props.connections.map((connection) => [connection.id, connection]));
  const items = summary.renewals.flatMap((renewal) => {
    const connection = byId.get(renewal.connectionId);
    return connection === undefined ? [] : [{ renewal, connection }];
  });
  const note = `Next ${renewalWindowDays} days`;
  if (items.length === 0) {
    return (
      <GlanceCard title="Upcoming Renewals" note={note}>
        <p className="w-spend-empty muted">No renewals in the next {renewalWindowDays} days</p>
      </GlanceCard>
    );
  }
  const marks = items.map(({ renewal, connection }, index): DayMark => ({
    key: renewal.connectionId,
    date: renewal.date,
    label: `${renewalName(connection)} · ${figureText(renewal.price)}`,
    emphasis: index === 0,
  }));
  const more = items.length - listed;
  return (
    <GlanceCard title="Upcoming Renewals" note={note}>
      <DayStrip
        label={`Renewals in the next ${renewalWindowDays} days`}
        start={summary.today}
        days={renewalWindowDays}
        marks={marks}
      />
      <ul className="w-renewals">
        {items.slice(0, listed).map(({ renewal, connection }) => (
          <li key={renewal.connectionId}>
            <span className="muted num">{dayLabel(renewal.date)}</span>
            <BrandMark provider={connection.provider} />
            <span className="w-renewal-name">{renewalName(connection)}</span>
            <span className="num">{figureText(renewal.price)}</span>
          </li>
        ))}
      </ul>
      {more > 0 ? <p className="w-renewals-more muted">+{more} more</p> : null}
    </GlanceCard>
  );
}
