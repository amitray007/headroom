import type { Provider } from "@headroom/core/contracts";

import { BrandMark } from "../icons.tsx";
import "./provider-chips.css";

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
    <fieldset className="pchips" aria-label={props.label}>
      <button
        className="pchip"
        type="button"
        aria-pressed={props.value === "all"}
        onClick={() => props.onChange("all")}
      >
        All <span className="n">{props.total}</span>
      </button>
      {props.options.map((option) => (
        <button
          key={option.provider}
          className="pchip"
          type="button"
          aria-pressed={props.value === option.provider}
          onClick={() => props.onChange(option.provider)}
        >
          <BrandMark provider={option.provider} />
          {option.label} <span className="n">{option.count}</span>
        </button>
      ))}
    </fieldset>
  );
}
