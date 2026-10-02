import { PlusIcon } from "../icons.tsx";
import { ConnectSkeleton } from "../connect/skeletons.tsx";
import { DashboardSkeleton } from "../dashboard/skeletons.tsx";
import { href, type Route } from "../router.ts";
import { ButtonLink } from "../ui/button.tsx";
import { Lockup } from "../ui/lockup.tsx";
import { Sk } from "../ui/skeleton.tsx";

/**
 * What a signed-in owner sees while the session is still being checked: the real top bar frame, with the
 * parts that need the session as placeholders, and the page in its final layout. It has the same geometry as
 * the shell that replaces it, so the swap changes only the placeholders.
 */
export function BootFrame(props: { readonly route: Route }) {
  const onConnectPage = props.route.page === "connect" || props.route.page === "reconnect";
  return (
    <div className="page">
      <header className="top">
        <Lockup href={href({ page: "connections" })} />
        <nav aria-label="Page">
          {onConnectPage ? (
            <ButtonLink href={href({ page: "connections" })}>Back to Accounts</ButtonLink>
          ) : (
            <ButtonLink variant="primary" icon={<PlusIcon />} href={href({ page: "connect" })}>
              Connect an Account
            </ButtonLink>
          )}
          <Sk width={36} height={36} className="sk-round" />
          <Sk width={34} height={34} className="sk-round" />
        </nav>
      </header>
      {onConnectPage ? <ConnectSkeleton /> : <DashboardSkeleton />}
    </div>
  );
}
