import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from "react";

import { AuthSkeleton, SignedOutPage, Unreachable } from "./auth-pages.tsx";
import { isDemoId } from "./api.ts";
import { authClient } from "./auth.ts";
import { ConnectSkeleton } from "./connect/skeletons.tsx";
import { DashboardPage } from "./dashboard/page.tsx";
import { useDemoOverview } from "./dashboard/use-demo-overview.ts";
import { demoOwnerName } from "@headroom/view-model/demo";
import { demoWallet } from "@headroom/view-model/wallet-demo";
import { expiringTopUps } from "@headroom/view-model/notifications";
import { useOverview } from "./dashboard/use-overview.ts";
import {
  browserStorage,
  readSessionHint,
  saveSessionHint,
  saveUsername,
  saveView,
  useDevicePrefs,
} from "./lib/device-prefs.ts";
import { CompareSkeleton } from "./views/compare/skeleton.tsx";
import { DetailedSkeleton } from "./views/detailed/skeleton.tsx";
import { TimelineSkeleton } from "./views/timeline/skeleton.tsx";
import { WalletSkeleton } from "./views/wallet/skeleton.tsx";
import { lazyNamed } from "./lib/lazy-named.ts";
import { SettingsProvider } from "./lib/settings.tsx";
import { useWallet } from "./lib/wallet-store.ts";
import { groupByProvider } from "@headroom/view-model/labels";
import { useNotifications } from "./lib/use-notifications.ts";
import { href, useRoute, viewOf, type Route } from "./router.ts";
import { BootFrame } from "./shell/boot.tsx";
import { Shell } from "./shell/shell.tsx";

// Everything but the Overview loads on demand. Each fallback is the page's own skeleton, which is also what the
// page draws while the overview loads, so the swap does not move anything.
const ConnectPage = lazyNamed(() => import("./connect-page.tsx"), "ConnectPage");
const DetailedPage = lazyNamed(() => import("./views/detailed/page.tsx"), "DetailedPage");
const ComparePage = lazyNamed(() => import("./views/compare/page.tsx"), "ComparePage");
const TimelinePage = lazyNamed(() => import("./views/timeline/page.tsx"), "TimelinePage");
const WalletPage = lazyNamed(() => import("./views/wallet/page.tsx"), "WalletPage");

// Development only: the component gallery lives at #/dev/ui. Production builds leave it out entirely.
const Gallery = import.meta.env.DEV
  ? lazy(async () => {
      const { Gallery: component } = await import("./ui/gallery.tsx");
      return { default: component };
    })
  : null;

const holdSkeleton =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has("skeleton");

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
  const loadedOverview = demoView ?? realOverview;
  // Development only: "?skeleton" before the hash holds every page on its first-load skeleton, to check it against the page.
  const overview = holdSkeleton
    ? { ...loadedOverview, connections: null, failed: false }
    : loadedOverview;
  // The Wallet's expiring credits raise notices, so the bell reads the same book the Wallet page shows.
  const connections = overview.connections;
  const wallet = useWallet(
    prefs.demo && connections !== null
      ? {
          key: `${prefs.demoSeed}:${prefs.demoAnchor}`,
          make: () => demoWallet(prefs.demoSeed, connections, prefs.demoAnchor),
        }
      : null,
  );
  const expiring = useMemo(
    () => (wallet.loaded ? expiringTopUps(wallet.book.topUps) : null),
    [wallet.loaded, wallet.book.topUps],
  );
  const notifications = useNotifications(
    connections,
    overview.failed,
    prefs.demo ? prefs.demoSeed : null,
    expiring,
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
      connections={connections}
      onAccountsChanged={overview.reload}
    >
      <Fragment key={mode}>
        {route.page === "connect" ? (
          <Suspense fallback={<ConnectSkeleton />}>
            <ConnectPage overview={overview} />
          </Suspense>
        ) : null}
        {route.page === "reconnect" ? (
          <Suspense fallback={<ConnectSkeleton />}>
            <ConnectPage key={route.id} reconnectId={route.id} overview={overview} />
          </Suspense>
        ) : null}
        {route.page === "overview" ? <DashboardPage overview={overview} /> : null}
        {route.page === "detailed" ? (
          <Suspense fallback={<DetailedSkeleton />}>
            <DetailedPage overview={overview} />
          </Suspense>
        ) : null}
        {route.page === "compare" ? (
          <Suspense fallback={<CompareSkeleton />}>
            <ComparePage overview={overview} />
          </Suspense>
        ) : null}
        {route.page === "timeline" ? (
          <Suspense fallback={<TimelineSkeleton />}>
            <TimelinePage overview={overview} />
          </Suspense>
        ) : null}
        {route.page === "wallet" ? (
          <Suspense fallback={<WalletSkeleton />}>
            <WalletPage overview={overview} />
          </Suspense>
        ) : null}
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
  if (Gallery !== null && route.page === "gallery") {
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
