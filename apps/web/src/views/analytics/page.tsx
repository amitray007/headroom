import { memo, useMemo, useState, type ReactNode } from "react";

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
import { Tabs } from "../../ui/tabs.tsx";
import type { ViewProps } from "../props.ts";
import { AccountFilter } from "./common.tsx";
import { fitLine, PlanFitCard } from "./fit.tsx";
import { Head, TabFace } from "./head.tsx";
import { buildAnalytics } from "./model.ts";
import { nowLine, RightNowCard } from "./now.tsx";
import { reportKeys, reports, reportStore, type Report } from "./reports.ts";
import { RhythmCard, summary } from "./rhythm.tsx";
import { buildSeries, narrowSeries } from "./series.ts";
import { AnalyticsSkeleton } from "./skeleton.tsx";
import { useStoredView } from "./stored-view.ts";
import { useHistory } from "./use-history.ts";
import "./analytics.css";
import "./common.css";

/**
 * Analytics: three questions, one report each, shown one at a time. Rhythm: when limits are used and where they
 * ran out. Forecast: what runs out before its reset. Plan fit: the changes worth making. The header holds what
 * every report shares, and each tab states its report's answer, so all three read without opening one. Each
 * report switches between views of the same answer. Percentages from different accounts are never added, and a
 * missing reading is a gap, not zero.
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

/**
 * Monthly cost in US dollars from the Wallet: 0 for a free or included plan. Null is unknown, with the reason in
 * `note`: no cost entry, the Wallet did not load, or the price is in a currency with no exchange rate.
 */
function monthlyUsd(
  cost: Parameters<typeof monthlyOf>[0],
  perUsd: Readonly<Partial<Record<string, number>>> | null,
  walletFailed: boolean,
): { readonly usd: number | null; readonly note: string } {
  if (walletFailed) return { usd: null, note: "Price unavailable" };
  // A free plan, or one included in another subscription, is a known $0: monthlyOf returns zero for it.
  const monthly = monthlyOf(cost);
  if (monthly === null) return { usd: null, note: "Price not set" };
  const usd = convert(monthly, "USD", perUsd ?? {});
  return usd === null
    ? { usd: null, note: `Price in ${monthly.currency}, no rate` }
    : { usd: usd.minor / 100, note: "" };
}

const wholeDays = (days: number): string => {
  const count = Math.floor(days);
  return `${count} ${count === 1 ? "day" : "days"}`;
};

/** The header's status line: how much history there is and how many accounts it covers. */
function statusLine(coverageDays: number | null, accounts: number): string {
  const covered =
    coverageDays === null
      ? null
      : `${coverageDays < 1 ? "Less than a day" : wholeDays(coverageDays)} of history`;
  const counted = `${accounts} ${accounts === 1 ? "account" : "accounts"}`;
  return covered === null ? counted : `${covered} · ${counted}`;
}

/** One quiet line when history is thin or the server keeps less than the longest range. */
function historyNote(coverageDays: number | null, retentionDays: number): string | null {
  const parts: string[] = [];
  if (retentionDays < 90) parts.push(`History keeps ${retentionDays} days.`);
  if (coverageDays !== null && coverageDays < 30 && coverageDays < retentionDays) {
    parts.push("Charts fill in as Headroom keeps reading your limits.");
  }
  return parts.length === 0 ? null : parts.join(" ");
}

const clock = (at: number): string =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

type Answer = { readonly big: ReactNode; readonly cap: ReactNode };

/** The report tabs: each names its report and time span and states the report's answer. */
function ReportTabs(props: {
  readonly open: Report;
  readonly answers: Readonly<Record<Report, Answer>>;
  readonly onOpen: (report: Report) => void;
}) {
  const tabs = reports.map((entry) => ({
    value: entry.value,
    label: <TabFace {...entry} {...props.answers[entry.value]} />,
  }));
  return (
    <Tabs
      label="Reports"
      tabs={tabs}
      value={props.open}
      onChange={props.onOpen}
      panelId="an-report"
      className="an-tabs"
      tabClassName="an-tab"
    />
  );
}

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
  const priced = useMemo(
    () =>
      connections.map((connection) => ({
        id: connection.id,
        ...monthlyUsd(wallet.book.costs[connection.id] ?? null, rates.perUsd, wallet.loadFailed),
      })),
    [connections, wallet.book.costs, wallet.loadFailed, rates.perUsd],
  );
  const costs = useMemo(() => new Map(priced.map((item) => [item.id, item.usd])), [priced]);
  const priceNotes = useMemo(() => new Map(priced.map((item) => [item.id, item.note])), [priced]);
  const history = state.kind === "ready" ? state.history : null;
  // History reaches back 90 days; the rhythm and the actions read the last 30 of them.
  const analytics = useMemo(
    () =>
      history === null ? null : buildAnalytics(connections, history, now, 90, costs, priceNotes),
    [connections, history, now, costs, priceNotes],
  );
  const series = useMemo(
    () => (analytics === null ? null : buildSeries(analytics, now)),
    [analytics, now],
  );
  // One account filter for every report, in the page header. Null is every account.
  const [focus, setFocus] = useState<string | null>(null);
  const [open, setOpen] = useStoredView<Report>(reportStore, reportKeys, "rhythm");
  // A picked account that left the list (removed, or Demo Mode turned on) falls back to every account.
  const inView = series?.accounts.find((account) => account.id === focus) ?? null;
  const focused = useMemo(
    () => (series === null ? null : narrowSeries(series, inView?.id ?? null)),
    [series, inView],
  );
  // Each tab states the answer of its report's first view for the accounts in view: the Rhythm Matrix, the
  // Forecast and the Plan fit History. Worked out once per rebuild, not on each clock tick.
  const answers = useMemo((): Readonly<Record<Report, Answer>> | null => {
    if (series === null || focused === null) return null;
    return { rhythm: summary(series, inView), now: nowLine(focused), fit: fitLine(focused) };
  }, [series, focused, inView]);
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
  if (
    analytics === null ||
    series === null ||
    focused === null ||
    answers === null ||
    !wallet.loaded
  ) {
    return <AnalyticsSkeleton />;
  }
  const note = [
    historyNote(analytics.history.coverageDays, analytics.history.retentionDays),
    state.kind === "ready" && state.refreshFailedAfter !== null
      ? `Showing history from ${clock(state.refreshFailedAfter)}. Refresh failed.`
      : null,
    wallet.loadFailed ? "Prices did not load, so costs and savings are unknown." : null,
  ]
    .filter((line): line is string => line !== null)
    .join(" ");
  const status = statusLine(analytics.history.coverageDays, analytics.accounts.length);
  if (analytics.history.empty || analytics.accounts.length === 0) {
    return (
      <>
        <Head status={status} />
        <section className="an2-card" aria-label="Analytics">
          <p className="an-empty">
            {analytics.history.empty
              ? "No history yet. Headroom reads your limits every few minutes; check back in a day."
              : "No limits to chart yet. Analytics charts usage limits. Your accounts report money only."}
          </p>
        </section>
      </>
    );
  }
  return (
    <>
      <Head status={status}>
        <AccountFilter accounts={series.accounts} value={inView?.id ?? null} onChange={setFocus} />
      </Head>
      {note === "" ? null : <p className="an-note">{note}</p>}
      <ReportTabs open={open} answers={answers} onOpen={setOpen} />
      {/* Hidden, not unmounted: a view, range or pick made in one report survives a visit to another. */}
      <div
        id="an-report"
        role="tabpanel"
        aria-label={reports.find((entry) => entry.value === open)?.label}
      >
        <div hidden={open !== "rhythm"}>
          <Rhythm series={series} focused={focused} account={inView} />
        </div>
        <div hidden={open !== "now"}>
          <RightNow series={focused} />
        </div>
        <div hidden={open !== "fit"}>
          <PlanFit series={focused} />
        </div>
      </div>
    </>
  );
}
