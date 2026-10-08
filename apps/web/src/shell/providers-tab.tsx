import type { Provider } from "@headroom/core/contracts";
import { providerName } from "@headroom/view-model/labels";

import { useSettings } from "../lib/settings.tsx";
import type { SettingsPatch } from "../lib/settings-store.ts";
import { Section, SwitchRow } from "./settings-rows.tsx";
import "./providers-tab.css";

/**
 * The providers whose panels have balance figures, and how to word the hide-at-zero choice. The choice covers every
 * balance figure of the provider (see `presentPanel`), so a new one needs no new switch.
 */
const balanceChoices: Partial<Record<Provider, { readonly title: string; readonly note: string }>> =
  {
    claude: {
      title: "Hide Credits at $0",
      note: "Any credit balance hides while it is $0 and shows again once it is above.",
    },
  };

/** Display choices per provider, one section each, for the providers with a connected account. */
export function ProvidersTab(props: {
  readonly providers: readonly Provider[];
  readonly change: (patch: SettingsPatch) => void;
}) {
  const { settings } = useSettings();
  const shown = props.providers.filter((provider) => balanceChoices[provider] !== undefined);
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
        const choice = balanceChoices[provider];
        if (choice === undefined) return null;
        return (
          <Section key={provider} title={providerName(provider)}>
            <SwitchRow
              title={choice.title}
              note={choice.note}
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
