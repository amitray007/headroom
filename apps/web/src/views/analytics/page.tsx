import { memo, useMemo, useState } from "react";

import { LoadFailed, NoAccounts } from "../../dashboard/states.tsx";
import { useNow } from "../../lib/now.ts";
import { useSettings } from "../../lib/settings.tsx";
import type { ViewProps } from "../props.ts";
import { PlanFitCard } from "./fit.tsx";
import { buildAnalytics } from "./model.ts";
import { RightNowCard } from "./now.tsx";
import { RhythmCard } from "./rhythm.tsx";
import { buildSeries } from "./series.ts";
import { AnalyticsSkeleton } from "./skeleton.tsx";
import "./analytics.css";
import "./common.css";

/**
 * Analytics (mockup): three questions, one card each. Rhythm: when limits are used and where they ran out. Right
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

function AnalyticsBoard(props: {
  readonly connections: NonNullable<ViewProps["overview"]["connections"]>;
}) {
  // The cards read history, not the live second: rebuild every five minutes, not on each 30 second tick.
  const now = Math.floor(useNow() / rebuildEvery) * rebuildEvery;
  // History reaches back 90 days; the rhythm and the actions read the last 30 of them.
  const analytics = useMemo(
    () => buildAnalytics(props.connections, now, 90),
    [props.connections, now],
  );
  const series = useMemo(() => buildSeries(analytics, now), [analytics, now]);
  return (
    <>
      <Rhythm series={series} />
      <RightNow series={series} />
      <PlanFit series={series} />
    </>
  );
}
