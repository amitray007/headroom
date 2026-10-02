import { useContext } from "react";

import type { Provider } from "@headroom/core/contracts";
import { providerName } from "@headroom/view-model/labels";

import { BrandMark } from "../icons.tsx";
import { MarkCard } from "../ui/mark-card.tsx";
import { Sk } from "../ui/skeleton.tsx";
import { VerifiedSeal } from "../ui/verified-seal.tsx";
import { WaitingContext } from "./settings-rows.tsx";

/** One card per provider, pressed while its notices are on. A filled seal means on, an outline means off. */
export function ProviderCards(props: {
  readonly providers: readonly Provider[];
  readonly muted: readonly Provider[];
  readonly onToggle: (provider: Provider, on: boolean) => void;
}) {
  const waiting = useContext(WaitingContext);
  return (
    <div className="cards ntf-cards" aria-busy={waiting}>
      {props.providers.map((provider) => {
        const on = !props.muted.includes(provider);
        return waiting ? (
          <Sk key={provider} height={56} className="sk-card-slot" />
        ) : (
          <MarkCard
            key={provider}
            mark={<BrandMark provider={provider} />}
            name={providerName(provider)}
            pressed={on}
            onClick={() => props.onToggle(provider, !on)}
            status={<VerifiedSeal size="sm" tone={on ? "good" : "muted"} />}
          />
        );
      })}
    </div>
  );
}
