import type { ReactNode } from "react";

import { cx } from "./cx.ts";
import "./fold.css";

/**
 * Content that collapses to zero height, with no gap left behind. While closed it is hidden from the tab order
 * and from assistive tech. Put any margin inside the fold, not around it, so the margin collapses too.
 */
export function Fold(props: {
  readonly closed: boolean;
  readonly id?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      id={props.id}
      className={cx("fold", props.closed && "closed", props.className)}
      inert={props.closed}
    >
      <div className="fold-clip">{props.children}</div>
    </div>
  );
}
