import { api } from "./api.ts";
import { AccountPage } from "./account-page.tsx";
import { SignedOutPage } from "./auth-pages.tsx";
import { authClient } from "./auth.ts";
import { ConnectPage } from "./connect-page.tsx";
import { ConnectionsPage } from "./connections-page.tsx";
import { DetailPage } from "./detail-page.tsx";
import { useLoad } from "./hooks.ts";
import { href, useRoute } from "./router.ts";

function SignedIn(props: { readonly userId: string }) {
  const route = useRoute();
  const me = useLoad(() => api.me(), `me:${props.userId}`);
  return (
    <>
      <header>
        <strong>Headroom</strong>
        <nav aria-label="Main">
          <a href={href({ page: "connections" })}>Connections</a>
          <a href={href({ page: "connect" })}>Connect</a>
          <a href={href({ page: "account" })}>Account</a>
        </nav>
      </header>
      {route.page === "connections" ? <ConnectionsPage /> : null}
      {route.page === "connect" ? <ConnectPage /> : null}
      {route.page === "reconnect" ? <ConnectPage key={route.id} reconnectId={route.id} /> : null}
      {route.page === "detail" ? <DetailPage key={route.id} id={route.id} /> : null}
      {route.page === "account" ? (
        <AccountPage name={me.data?.name ?? ""} email={me.data?.email ?? ""} />
      ) : null}
    </>
  );
}

export function App() {
  const session = authClient.useSession();
  if (session.isPending) {
    return (
      <main>
        <p aria-busy="true">Loading...</p>
      </main>
    );
  }
  if (session.data === null) return <SignedOutPage />;
  return <SignedIn userId={session.data.user.id} />;
}
