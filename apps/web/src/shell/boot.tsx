import { Avatar, PlusIcon } from "../icons.tsx";
import { browserStorage, readDemo, readUsername } from "../lib/device-prefs.ts";
import { ConnectSkeleton } from "../connect/skeletons.tsx";
import { DashboardSkeleton } from "../dashboard/skeletons.tsx";
import { href, viewOf, type Route } from "../router.ts";
import { ButtonLink } from "../ui/button.tsx";
import { Lockup } from "../ui/lockup.tsx";
import { Sk } from "../ui/skeleton.tsx";
import { ViewSwitcher } from "../ui/view-switcher.tsx";
import { CompareSkeleton } from "../views/compare/skeleton.tsx";
import { DetailedSkeleton } from "../views/detailed/skeleton.tsx";
import { TimelineSkeleton } from "../views/timeline/skeleton.tsx";
import { WalletSkeleton } from "../views/wallet/skeleton.tsx";

/** The skeleton the page itself shows first, so the boot frame hands over without a change. */
function PageSkeleton(props: { readonly route: Route }) {
  switch (props.route.page) {
    case "connect":
    case "reconnect":
      return <ConnectSkeleton />;
    case "detailed":
      return <DetailedSkeleton />;
    case "compare":
      return <CompareSkeleton />;
    case "timeline":
      return <TimelineSkeleton />;
    case "wallet":
      return <WalletSkeleton />;
    case "overview":
    case "gallery":
      return <DashboardSkeleton />;
  }
}

/**
 * What a signed-in owner sees while the session is still being checked: the real top bar frame, with the
 * parts that need the session as placeholders, and the page in its final layout. It has the same geometry as
 * the shell that replaces it, so the swap changes only the placeholders.
 */
export function BootFrame(props: { readonly route: Route }) {
  const view = viewOf(props.route);
  const storage = browserStorage();
  // Demo Mode never shows the real owner, not even in the frame before the session loads.
  const username = storage === null || readDemo(storage) ? null : readUsername(storage);
  const onConnectPage = props.route.page === "connect" || props.route.page === "reconnect";
  return (
    <div className="page">
      <header className="top">
        <Lockup href={href({ page: "overview" })} />
        {view === null ? null : <ViewSwitcher active={view} />}
        <nav aria-label="Page">
          {onConnectPage ? (
            <ButtonLink href={href({ page: "overview" })}>Back to Accounts</ButtonLink>
          ) : (
            <ButtonLink variant="primary" icon={<PlusIcon />} href={href({ page: "connect" })}>
              Connect
            </ButtonLink>
          )}
          <Sk width={36} height={36} className="sk-round" />
          <span className="avatar" aria-hidden="true">
            <Avatar seed={username} />
          </span>
        </nav>
      </header>
      <PageSkeleton route={props.route} />
    </div>
  );
}
