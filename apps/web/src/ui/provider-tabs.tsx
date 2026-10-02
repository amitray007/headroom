import type { Provider } from "@headroom/core/contracts";

import { ProviderToken } from "./provider-token.tsx";
import { Tabs } from "./tabs.tsx";

/** One tab: a provider, the name to show and how many accounts it has. */
interface ProviderTab {
  readonly provider: Provider;
  readonly name: string;
  readonly count: number;
}

/** Tabs that choose a provider, drawn as pills. Keys and roles come from `Tabs`. */
export function ProviderTabs(props: {
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly tabs: readonly ProviderTab[];
  readonly value: Provider;
  readonly onChange: (provider: Provider) => void;
  readonly panelId: string;
}) {
  return (
    <Tabs
      label={props.label}
      className="ptokens"
      tabClassName="ptoken"
      panelId={props.panelId}
      value={props.value}
      onChange={props.onChange}
      tabs={props.tabs.map((tab) => ({
        value: tab.provider,
        label: <ProviderToken provider={tab.provider} name={tab.name} count={tab.count} />,
      }))}
    />
  );
}
