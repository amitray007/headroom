import type { ReactNode } from "react";

/**
 * A card button: a mark and a name on the left, a status mark on the right. `pressed` is the card's state, chosen
 * or switched on, so the status mark is decorative unless it says something more.
 */
export function MarkCard(props: {
  readonly mark: ReactNode;
  readonly name: string;
  readonly pressed: boolean;
  readonly status?: ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="card" aria-pressed={props.pressed} onClick={props.onClick}>
      <span className="head">
        {props.mark}
        <span className="card-name">{props.name}</span>
        {props.status === undefined ? null : <span className="card-status">{props.status}</span>}
      </span>
    </button>
  );
}
