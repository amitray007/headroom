import { PlusIcon } from "../icons.tsx";
import type { NotificationsView } from "../lib/use-notifications.ts";
import { href, type ViewId } from "../router.ts";
import { ButtonLink } from "../ui/button.tsx";
import { Lockup } from "../ui/lockup.tsx";
import { ViewSwitcher } from "../ui/view-switcher.tsx";
import { AccountMenu } from "./account-menu.tsx";
import { NotificationCentre } from "./notification-centre.tsx";

/**
 * Lockup on the left, the view switcher in the middle, connect link, notifications and the account menu on the
 * right. The connect pages are a task, not a view, so they swap the switcher for a Back to Accounts link and
 * show no view as active.
 */
export function TopBar(props: {
  /** The view being shown, or null on the connect pages. */
  readonly view: ViewId | null;
  readonly name: string;
  readonly notifications: NotificationsView;
  readonly onSettings: () => void;
  readonly onAccount: () => void;
}) {
  return (
    <header className="top">
      <Lockup href={href({ page: "overview" })} />
      {props.view === null ? null : <ViewSwitcher active={props.view} />}
      <nav aria-label="Page">
        {props.view === null ? (
          <ButtonLink href={href({ page: "overview" })}>Back to Accounts</ButtonLink>
        ) : (
          <ButtonLink variant="primary" icon={<PlusIcon />} href={href({ page: "connect" })}>
            Connect
          </ButtonLink>
        )}
        <NotificationCentre notifications={props.notifications} />
        <AccountMenu name={props.name} onSettings={props.onSettings} onAccount={props.onAccount} />
      </nav>
    </header>
  );
}
