import { PlugIcon, PlusIcon } from "../icons.tsx";
import { href } from "../router.ts";
import { ButtonLink } from "../ui/button.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";

export function NoAccounts() {
  return (
    <EmptyState
      framed
      icon={<PlugIcon />}
      title="No Accounts Connected"
      actions={
        <ButtonLink variant="primary" href={href({ page: "connect" })}>
          Connect an Account
        </ButtonLink>
      }
    >
      Connect a provider account and its limits, balances and resets appear here within a minute.
    </EmptyState>
  );
}

/** The overview did not load. With `stale`, the panels below are the last good load. */
export function LoadFailed(props: {
  readonly stale: boolean;
  readonly busy: boolean;
  readonly onRetry: () => void;
}) {
  return (
    <ErrorNotice busy={props.busy} onRetry={props.onRetry}>
      {props.stale
        ? "Headroom could not refresh. The numbers below are from the last good load."
        : "Headroom could not load your accounts. Check that it is running and try again."}
    </ErrorNotice>
  );
}

export function AddAccountLink() {
  return (
    <a className="add" href={href({ page: "connect" })}>
      <PlusIcon /> Connect Another Account
    </a>
  );
}
