import type { Provider } from "@headroom/core/contracts";

import { ProviderToken } from "./provider-token.tsx";

export type ProviderFilter = Provider | "all";

/**
 * A row of filter chips: All with the total, then one chip per provider with its count. The caller passes the
 * providers in the order to show. On a narrow screen the row scrolls sideways.
 */
export function ProviderChips(props: {
  readonly value: ProviderFilter;
  readonly onChange: (value: ProviderFilter) => void;
  readonly total: number;
  readonly options: readonly {
    readonly provider: Provider;
    readonly label: string;
    readonly count: number;
  }[];
  /** Accessible name of the group. */
  readonly label: string;
}) {
  return (
    <fieldset className="ptokens" aria-label={props.label}>
      <button
        className="ptoken"
        type="button"
        aria-pressed={props.value === "all"}
        onClick={() => props.onChange("all")}
      >
        <ProviderToken name="All" count={props.total} />
      </button>
      {props.options.map((option) => (
        <button
          key={option.provider}
          className="ptoken"
          type="button"
          aria-pressed={props.value === option.provider}
          onClick={() => props.onChange(option.provider)}
        >
          <ProviderToken provider={option.provider} name={option.label} count={option.count} />
        </button>
      ))}
    </fieldset>
  );
}
