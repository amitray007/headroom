import type { ReactNode } from "react";

import { AlertIcon } from "../icons.tsx";
import { Button } from "./button.tsx";
import { cx } from "./cx.ts";

/**
 * A failed load, in plain words, with Try Again. `busy` shows the retry in progress. Without `onRetry` it is
 * only a message. Use `inline` inside a card, where the notice needs no outer margin.
 */
export function ErrorNotice(props: {
  readonly children: ReactNode;
  readonly onRetry?: () => void;
  readonly busy?: boolean;
  readonly inline?: boolean;
}) {
  return (
    <div className={cx("notice", "bad", props.inline === true && "inline")} role="alert">
      <span className="text">
        <AlertIcon />
        {props.children}
      </span>
      {props.onRetry === undefined ? null : (
        <Button size="sm" busy={props.busy === true} busyLabel="Trying" onClick={props.onRetry}>
          Try Again
        </Button>
      )}
    </div>
  );
}
