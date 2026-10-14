import { memo, useMemo, useState } from "react";

import { convert } from "@headroom/view-model/wallet-money";
import { demoHistory } from "@headroom/view-model/history-demo";
import { monthlyOf } from "@headroom/view-model/wallet";
import { demoWallet } from "@headroom/view-model/wallet-demo";

import { LoadFailed, NoAccounts } from "../../dashboard/states.tsx";
import { useDevicePrefs } from "../../lib/device-prefs.ts";
import { useExchangeRates } from "../../lib/exchange-rates.ts";
import { useNow } from "../../lib/now.ts";
import { useSettings } from "../../lib/settings.tsx";
import { useWallet } from "../../lib/wallet-store.ts";
import { ErrorNotice } from "../../ui/error-notice.tsx";
import type { ViewProps } from "../props.ts";
import { PlanFitCard } from "./fit.tsx";
import { buildAnalytics } from "./model.ts";
import { RightNowCard } from "./now.tsx";
import { RhythmCard } from "./rhythm.tsx";
import { buildSeries } from "./series.ts";
import { AnalyticsSkeleton } from "./skeleton.tsx";
import { useHistory } from "./use-history.ts";
import "./analytics.css";
import "./common.css";

/**
 * Analytics: three questions, one card each. Rhythm: when limits are used and where they ran out. Right
 * now: what runs out before its reset. Plan fit: the changes worth making. Each card switches between views of
 * the same answer. Percentages from different accounts are never added, and a missing reading is a gap, not zero.
 */
export function AnalyticsPage(props: ViewProps) {
  const { connections, failed, stale, reload } = props.overview;
  const { loaded } = useSettings();
  const [retrying, setRetrying] = useState(false);
  const retry = (): void => {
    setRetrying(true);
    void reload().finally(() => setRetrying(false));
  };
  if (connections === null) {
    return failed ? (
      <LoadFailed stale={false} busy={retrying} onRetry={retry} />
    ) : (
      <AnalyticsSkeleton />
    );
  }
  if (!loaded) return <AnalyticsSkeleton />;
  if (connections.length === 0) {
    return (
      <div className="reveal">
        <NoAccounts />
      </div>
    );
  }
  return (
    <div className="reveal an-page">
      {stale ? <LoadFailed stale busy={retrying} onRetry={retry} /> : null}
      <AnalyticsBoard connections={connections} />
    </div>
  );
}

const rebuildEvery = 5 * 60_000;

// Each card redraws only when its series changes, not on every clock tick of the page.
const Rhythm = memo(RhythmCard);
const RightNow = memo(RightNowCard);
const PlanFit = memo(PlanFitCard);

type Connections = NonNullable<ViewProps["overview"]["connections"]>;

/** Monthly cost in US dollars from the Wallet: 0 for a free or included plan, null when not set or no exchange rate. */
function monthlyUsd(
  cost: Parameters<typeof monthlyOf>[0],
  perUsd: Readonly<Partial<Record<string, number>>> | null,
): number | null {
  // No cost entry is unknown. A free plan, or one included in another subscription, is a known $0: monthlyOf
  // returns zero for it.
  if (cost === null) return null;
  const monthly = monthlyOf(cost);
  if (monthly === null) return null;
  const usd = convert(monthly, "USD", perUsd ?? {});
  return usd === null ? null : usd.minor / 100;
}

const wholeDays = (days: number): string => {
  const count = Math.floor(days);
  return `${count} ${count === 1 ? "day" : "days"}`;
};

/** One quiet line when history is thin or the server keeps less than the longest range. */
function historyNote(coverageDays: number | null, retentionDays: number): string | null {
  const thin = coverageDays !== null && coverageDays < 30;
  const short = retentionDays < 90;
  if (!thin && !short) return null;
  const parts: string[] = [];
  if (thin) {
    parts.push(
      coverageDays < 1
        ? "Less than a day of history so far."
        : `${wholeDays(coverageDays)} of history so far.`,
    );
  }
  if (short) parts.push(`History keeps ${retentionDays} days.`);
  if (thin && coverageDays < retentionDays) {
    parts.push("Charts fill in as Headroom keeps reading your limits.");
  }
  return parts.join(" ");
}

const emptyCards = ["Rhythm", "Right Now", "Plan Fit"] as const;

function AnalyticsBoard(props: { readonly connections: Connections }) {
  const { connections } = props;
  const prefs = useDevicePrefs();
  const rates = useExchangeRates();
  // The Wallet's costs price each account; Demo Mode reads its own in-memory book.
  const wallet = useWallet(
    prefs.demo
      ? {
          key: `${prefs.demoSeed}:${prefs.demoAnchor}`,
          make: () => demoWallet(prefs.demoSeed, connections, prefs.demoAnchor),
        }
      : null,
  );
  const idsKey = connections
    .map((connection) => connection.id)
    .toSorted()
    .join(",");
  const [retrying, setRetrying] = useState(false);
  const { state, reload } = useHistory(
    prefs.demo
      ? {
          key: `${prefs.demoSeed}:${prefs.demoAnchor}`,
          make: () => demoHistory(prefs.demoSeed, connections, prefs.demoAnchor, 90),
        }
      : null,
    idsKey,
  );
  // The cards read history, not the live second: rebuild every five minutes, not on each 30 second tick.
  const now = Math.floor(useNow() / rebuildEvery) * rebuildEvery;
  const costs = useMemo(
    () =>
      new Map(
        connections.map((connection) => [
          connection.id,
          monthlyUsd(wallet.book.costs[connection.id] ?? null, rates.perUsd),
        ]),
      ),
    [connections, wallet.book.costs, rates.perUsd],
  );
  const history = state.kind === "ready" ? state.history : null;
  // History reaches back 90 days; the rhythm and the actions read the last 30 of them.
  const analytics = useMemo(
    () => (history === null ? null : buildAnalytics(connections, history, now, 90, costs)),
    [connections, history, now, costs],
  );
  const series = useMemo(
    () => (analytics === null ? null : buildSeries(analytics, now)),
    [analytics, now],
  );
  if (state.kind === "failed") {
    return (
      <ErrorNotice
        busy={retrying}
        onRetry={() => {
          setRetrying(true);
          void reload().finally(() => setRetrying(false));
        }}
      >
        Headroom could not load your usage history. Check that it is running and try again.
      </ErrorNotice>
    );
  }
  if (analytics === null || series === null) return <AnalyticsSkeleton />;
  const note = historyNote(analytics.history.coverageDays, analytics.history.retentionDays);
  if (analytics.history.empty) {
    return (
      <>
        {emptyCards.map((title) => (
          <section className="an2-card" aria-label={title} key={title}>
            <p className="an-empty">
              No history yet. Headroom reads your limits every few minutes; check back in a day.
            </p>
          </section>
        ))}
      </>
    );
  }
  return (
    <>
      {note === null ? null : <p className="an-note">{note}</p>}
      <Rhythm series={series} />
      <RightNow series={series} />
      <PlanFit series={series} />
    </>
  );
}
