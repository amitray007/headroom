import { useEffect, useState, type ReactNode } from "react";

import { cx } from "./cx.ts";
import { prefersReducedMotion } from "./motion.ts";

/**
 * Text swap: when `swapKey` changes the old content leaves upward while the new content rises in from
 * below with a blur. Without a key change the content shows as is.
 */
export function Swap(props: {
  readonly swapKey: string;
  readonly contentClassName?: string;
  readonly children: ReactNode;
}) {
  const { swapKey, children } = props;
  const [state, setState] = useState<{
    readonly key: string;
    readonly node: ReactNode;
    readonly leaving: ReactNode;
    readonly animate: boolean;
  }>({ key: swapKey, node: children, leaving: null, animate: false });
  if (state.key !== swapKey) {
    setState({
      key: swapKey,
      node: children,
      leaving: state.node,
      animate: !prefersReducedMotion(),
    });
  } else if (state.node !== children) {
    setState({ ...state, node: children });
  }
  const { animate } = state;
  useEffect(() => {
    if (!animate) return;
    const timer = setTimeout(() => setState((s) => ({ ...s, leaving: null, animate: false })), 260);
    return () => clearTimeout(timer);
  }, [animate]);
  return (
    <span className="swap">
      {animate && state.leaving !== null ? (
        <span className={cx(props.contentClassName, "swap-out")} aria-hidden="true">
          {state.leaving}
        </span>
      ) : null}
      <span key={swapKey} className={cx(props.contentClassName, animate && "swap-in")}>
        {children}
      </span>
    </span>
  );
}
