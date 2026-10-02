import type { Provider } from "@headroom/core/contracts";
import { useRef, type KeyboardEvent } from "react";

import { ProviderToken } from "./provider-token.tsx";

/** One tab: a provider, the name to show and how many accounts it has. */
export interface ProviderTab {
  readonly provider: Provider;
  readonly name: string;
  readonly count: number;
}

/**
 * Tabs that choose a provider. Left and Right move between them and select as they go; Home and End jump to the
 * ends. Put the content in an element with `role="tabpanel"` and pass its id as `panelId`.
 */
export function ProviderTabs(props: {
  /** Accessible name of the tab list. */
  readonly label: string;
  readonly tabs: readonly ProviderTab[];
  readonly value: Provider;
  readonly onChange: (provider: Provider) => void;
  readonly panelId: string;
}) {
  const { tabs, value, onChange } = props;
  const list = useRef<HTMLDivElement>(null);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = tabs.findIndex((tab) => tab.provider === value);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : null;
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : step === null
            ? null
            : (at + step + tabs.length) % tabs.length;
    const next = target === null ? undefined : tabs[target];
    if (next === undefined) return;
    event.preventDefault();
    onChange(next.provider);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[target ?? 0]?.focus();
  };

  return (
    <div
      ref={list}
      className="ptokens"
      role="tablist"
      aria-label={props.label}
      tabIndex={-1}
      onKeyDown={move}
    >
      {tabs.map((tab) => {
        const selected = tab.provider === value;
        return (
          <button
            key={tab.provider}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={props.panelId}
            tabIndex={selected ? 0 : -1}
            className="ptoken"
            onClick={() => onChange(tab.provider)}
          >
            <ProviderToken provider={tab.provider} name={tab.name} count={tab.count} />
          </button>
        );
      })}
    </div>
  );
}
