import type { Provider } from "@headroom/core/contracts";
import { providerName } from "@headroom/view-model/labels";

import { useSettings } from "../lib/settings.tsx";
import type { SettingsPatch } from "../lib/settings-store.ts";
import { Section, SwitchRow } from "./settings-rows.tsx";
import "./providers-tab.css";

/**
 * The providers whose panels have a choice here, and the name of their balance figure. A provider joins this list when
 * its panel gains a figure the choice applies to.
 */
const balanceNames: Partial<Record<Provider, string>> = {
  claude: "Usage Credits",
};

/** Display choices per provider, one section each, for the providers with a connected account. */
export function ProvidersTab(props: {
  readonly providers: readonly Provider[];
  readonly change: (patch: SettingsPatch) => void;
}) {
  const { settings } = useSettings();
  const shown = props.providers.filter((provider) => balanceNames[provider] !== undefined);
  if (shown.length === 0) {
    return (
      <Section title="Providers">
        <p className="prov-empty muted">None of your connected providers has display options.</p>
      </Section>
    );
  }
  return (
    <>
      {shown.map((provider) => {
        const name = balanceNames[provider] ?? "Balance";
        return (
          <Section key={provider} title={providerName(provider)}>
            <SwitchRow
              title={`Hide ${name} at $0`}
              note="Shown again as soon as the balance is above $0."
              checked={settings.providers[provider]?.hideZeroBalance === true}
              onChange={(hideZeroBalance) =>
                props.change({ providers: { [provider]: { hideZeroBalance } } })
              }
            />
          </Section>
        );
      })}
    </>
  );
}
