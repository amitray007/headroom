import { useState } from "react";

import { groupByProvider } from "../lib/labels.ts";
import { useSettings } from "../lib/settings.tsx";
import { ProviderSection } from "./provider-section.tsx";
import { DashboardSkeleton } from "./skeletons.tsx";
import { AddAccountLink, LoadFailed, NoAccounts } from "./states.tsx";
import type { useOverview } from "./use-overview.ts";

/** The one dashboard page: every provider, every account, no sidebars. */
export function DashboardPage(props: { readonly overview: ReturnType<typeof useOverview> }) {
  const { connections, providerOrder, failed, stale, reload } = props.overview;
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
      <DashboardSkeleton />
    );
  }
  // Figures wait for the settings too, so Used or Left, the clock and the density never change after they show.
  if (!loaded) return <DashboardSkeleton />;
  if (connections.length === 0) {
    return (
      <div className="reveal">
        <NoAccounts />
      </div>
    );
  }
  return (
    <div className="reveal">
      {stale ? <LoadFailed stale busy={retrying} onRetry={retry} /> : null}
      {groupByProvider(connections, providerOrder).map((group) => (
        <ProviderSection
          key={group.provider}
          provider={group.provider}
          connections={group.connections}
          onChanged={reload}
        />
      ))}
      <AddAccountLink />
    </div>
  );
}
