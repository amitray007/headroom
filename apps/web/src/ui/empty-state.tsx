import type { ReactNode } from "react";

import { cx } from "./cx.ts";

/**
 * Nothing here yet: a tile with an icon, a title, one plain line and optional actions. `framed` draws it as its
 * own panel; `compact` fits it inside a card, a list or a popover.
 */
export function EmptyState(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
  readonly framed?: boolean;
  readonly compact?: boolean;
}) {
  const body = (
    <div className={cx("empty", props.compact === true && "compact")}>
      <div className="tile" aria-hidden="true">
        {props.icon}
      </div>
      <h2>{props.title}</h2>
      {props.children === undefined ? null : <p>{props.children}</p>}
      {props.actions === undefined ? null : <div className="actions">{props.actions}</div>}
    </div>
  );
  return props.framed === true ? <section className="panel">{body}</section> : body;
}
