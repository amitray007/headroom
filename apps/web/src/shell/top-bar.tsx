import { CloseIcon, DemoIcon, PlusIcon } from "../icons.tsx";
import { useDevicePrefs } from "../lib/device-prefs.ts";
import type { NotificationsView } from "../lib/use-notifications.ts";
import { href, type ViewId } from "../router.ts";
import { ButtonLink } from "../ui/button.tsx";
import { Lockup } from "../ui/lockup.tsx";
import { ViewSwitcher } from "../ui/view-switcher.tsx";
import { AccountMenu } from "./account-menu.tsx";
import { NotificationCentre } from "./notification-centre.tsx";

/**
 * Lockup on the left, the view switcher in the middle, connect link, notifications and the account menu on the
 * right, and while Demo Mode is on a Demo pill that turns it off. The connect pages are a task, not a view, so they swap the switcher for a Back to Accounts link and
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
  const prefs = useDevicePrefs();
  return (
    <header className="top">
      <Lockup href={href({ page: "overview" })} />
      {props.view === null ? null : <ViewSwitcher active={props.view} />}
      <nav aria-label="Page">
        {prefs.demo ? (
          <button
            type="button"
            className="pill neutral demo-pill"
            aria-label="Turn off Demo Mode"
            title="Turn off Demo Mode"
            onClick={() => prefs.setDemo(false)}
          >
            <DemoIcon />
            Demo
            <CloseIcon />
          </button>
        ) : null}
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
