import type { Provider } from "@headroom/core/contracts";

import { BrandMark } from "../icons.tsx";
import "./provider-token.css";

/**
 * The inside of a provider pill: the brand mark (none for "All"), the name and how many accounts. The caller
 * supplies the button, with `className="ptoken"` and its own role and state.
 */
export function ProviderToken(props: {
  readonly provider?: Provider;
  readonly name: string;
  readonly count: number;
}) {
  return (
    <>
      {props.provider === undefined ? null : <BrandMark provider={props.provider} />}
      {props.name} <span className="n">{props.count}</span>
    </>
  );
}
