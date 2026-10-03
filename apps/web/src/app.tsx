import { lazy, Suspense, useEffect, useState } from "react";

import { AuthSkeleton, SignedOutPage, Unreachable } from "./auth-pages.tsx";
import { authClient } from "./auth.ts";
import { ConnectPage } from "./connect-page.tsx";
import { DashboardPage } from "./dashboard/page.tsx";
import { useOverview } from "./dashboard/use-overview.ts";
import {
  browserStorage,
  readSessionHint,
  saveSessionHint,
  saveUsername,
  saveView,
} from "./lib/device-prefs.ts";
import { ComparePage } from "./views/compare/page.tsx";
import { DetailedPage } from "./views/detailed/page.tsx";
import { TimelinePage } from "./views/timeline/page.tsx";
import { SettingsProvider } from "./lib/settings.tsx";
import { groupByProvider } from "@headroom/view-model/labels";
import { useNotifications } from "./lib/use-notifications.ts";
import { useRoute, viewOf } from "./router.ts";
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
  const route = useRoute();
  const overview = useOverview();
  const notifications = useNotifications(overview.connections, overview.failed);
  const view = viewOf(route);
  const providers = groupByProvider(overview.connections ?? [], overview.providerOrder).map(
    (group) => group.provider,
  );
  // This device reopens on the view it used last.
  useEffect(() => {
    const storage = browserStorage();
    if (storage !== null && view !== null) saveView(storage, view);
  }, [view]);
  return (
    <Shell view={view} name={props.name} notifications={notifications} providers={providers}>
      {route.page === "connect" ? <ConnectPage overview={overview} /> : null}
      {route.page === "reconnect" ? (
        <ConnectPage key={route.id} reconnectId={route.id} overview={overview} />
      ) : null}
      {route.page === "overview" ? <DashboardPage overview={overview} /> : null}
      {route.page === "detailed" ? <DetailedPage overview={overview} /> : null}
      {route.page === "compare" ? <ComparePage overview={overview} /> : null}
      {route.page === "timeline" ? <TimelinePage overview={overview} /> : null}
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
