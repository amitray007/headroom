import { Fragment, lazy, Suspense, useEffect, useState } from "react";

import { AuthSkeleton, SignedOutPage, Unreachable } from "./auth-pages.tsx";
import { isDemoId } from "./api.ts";
import { authClient } from "./auth.ts";
import { ConnectPage } from "./connect-page.tsx";
import { DashboardPage } from "./dashboard/page.tsx";
import { useDemoOverview } from "./dashboard/use-demo-overview.ts";
import { demoOwnerName } from "@headroom/view-model/demo";
import { useOverview } from "./dashboard/use-overview.ts";
import {
  browserStorage,
  readSessionHint,
  saveSessionHint,
  saveUsername,
  saveView,
  useDevicePrefs,
} from "./lib/device-prefs.ts";
import { ComparePage } from "./views/compare/page.tsx";
import { DetailedPage } from "./views/detailed/page.tsx";
import { TimelinePage } from "./views/timeline/page.tsx";
import { WalletPage } from "./views/wallet/page.tsx";
import { SettingsProvider } from "./lib/settings.tsx";
import { groupByProvider } from "@headroom/view-model/labels";
import { useNotifications } from "./lib/use-notifications.ts";
import { href, useRoute, viewOf, type Route } from "./router.ts";
import { BootFrame } from "./shell/boot.tsx";
import { Shell } from "./shell/shell.tsx";

// Development only: the component gallery lives at #/dev/ui.
const Gallery = lazy(async () => {
  const { Gallery: component } = await import("./ui/gallery.tsx");
  return { default: component };
});

function SignedIn(props: { readonly name: string }) {
  // The boot frame draws this owner's avatar on the next visit before the session is known.
  useEffect(() => {
    const storage = browserStorage();
    if (storage !== null) saveUsername(storage, props.name);
  }, [props.name]);
  const prefs = useDevicePrefs();
  const requested = useRoute();
  // The real overview always runs and keeps polling, so it is ready the moment Demo Mode turns off.
  const realOverview = useOverview();
  const demoView = useDemoOverview(prefs.demo, prefs.demoSeed, prefs.demoAnchor);
  const overview = demoView ?? realOverview;
  const notifications = useNotifications(
    overview.connections,
    overview.failed,
    prefs.demo ? prefs.demoSeed : null,
  );
  // A reconnect page for a demo account has no real account behind it once Demo Mode is off.
  const strandedInDemo = !prefs.demo && requested.page === "reconnect" && isDemoId(requested.id);
  const route: Route = strandedInDemo ? { page: "connect" } : requested;
  useEffect(() => {
    if (strandedInDemo) window.location.replace(href({ page: "connect" }));
  }, [strandedInDemo]);
  const view = viewOf(route);
  // Settings are real, so the provider list comes from the real overview even in Demo Mode.
  const providers = groupByProvider(realOverview.connections ?? [], realOverview.providerOrder).map(
    (group) => group.provider,
  );
  // Each mode mounts its own pages, so the entrance plays again and no editor or confirm carries over.
  const mode = prefs.demo ? "demo" : "real";
  // This device reopens on the view it used last.
  useEffect(() => {
    const storage = browserStorage();
    if (storage !== null && view !== null) saveView(storage, view);
  }, [view]);
  return (
    <Shell
      view={view}
      // The made-up accounts come with a made-up owner, so the real username stays off screen.
      name={prefs.demo ? demoOwnerName(prefs.demoSeed) : props.name}
      notifications={notifications}
      providers={providers}
    >
      <Fragment key={mode}>
        {route.page === "connect" ? <ConnectPage overview={overview} /> : null}
        {route.page === "reconnect" ? (
          <ConnectPage key={route.id} reconnectId={route.id} overview={overview} />
        ) : null}
        {route.page === "overview" ? <DashboardPage overview={overview} /> : null}
        {route.page === "detailed" ? <DetailedPage overview={overview} /> : null}
        {route.page === "compare" ? <ComparePage overview={overview} /> : null}
        {route.page === "timeline" ? <TimelinePage overview={overview} /> : null}
        {route.page === "wallet" ? <WalletPage overview={overview} /> : null}
      </Fragment>
    </Shell>
  );
}

/** This browser was signed in last time, so the first paint is the dashboard frame, not the sign-in card. */
function wasSignedIn(): boolean {
  const storage = browserStorage();
  return storage !== null && readSessionHint(storage);
}

export function App() {
  const session = authClient.useSession();
  const route = useRoute();
  const [hinted] = useState(wasSignedIn);
  const [retrying, setRetrying] = useState(false);
  const signedIn = session.isPending ? null : session.data !== null && !session.error;
  useEffect(() => {
    if (signedIn === null || session.error) return;
    const storage = browserStorage();
    if (storage !== null) saveSessionHint(storage, signedIn);
  }, [signedIn, session.error]);
  if (import.meta.env.DEV && route.page === "gallery") {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }
  if (session.isPending) return hinted ? <BootFrame route={route} /> : <AuthSkeleton />;
  if (session.error) {
    return (
      <Unreachable
        task="check your session"
        status={session.error.status}
        busy={retrying}
        onRetry={() => {
          setRetrying(true);
          void Promise.resolve(session.refetch()).finally(() => setRetrying(false));
        }}
      />
    );
  }
  if (session.data === null) return <SignedOutPage />;
  const user = session.data.user;
  return (
    <SettingsProvider key={user.id}>
      <SignedIn name={user.username ?? user.name} />
    </SettingsProvider>
  );
}
