import { PlusIcon } from "../icons.tsx";
import type { NotificationsView } from "../lib/use-notifications.ts";
import { href } from "../router.ts";
import { ButtonLink } from "../ui/button.tsx";
import { Lockup } from "../ui/lockup.tsx";
import { AccountMenu } from "./account-menu.tsx";
import { NotificationCentre } from "./notification-centre.tsx";

/** Lockup on the left; connect link, notifications and the account menu on the right. */
export function TopBar(props: {
  readonly onConnectPage: boolean;
  readonly name: string;
  readonly notifications: NotificationsView;
  readonly onSettings: () => void;
  readonly onAccount: () => void;
}) {
  return (
    <header className="top">
      <Lockup href={href({ page: "connections" })} />
      <nav aria-label="Page">
        {props.onConnectPage ? (
          <ButtonLink href={href({ page: "connections" })}>Back to Accounts</ButtonLink>
        ) : (
          <ButtonLink variant="primary" icon={<PlusIcon />} href={href({ page: "connect" })}>
            Connect an Account
          </ButtonLink>
        )}
        <NotificationCentre notifications={props.notifications} />
        <AccountMenu name={props.name} onSettings={props.onSettings} onAccount={props.onAccount} />
      </nav>
    </header>
  );
}
