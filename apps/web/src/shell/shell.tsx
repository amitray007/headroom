import type { Provider } from "@headroom/core/contracts";
import { Suspense, useEffect, useState, type ReactNode } from "react";

import type { ViewId } from "../router.ts";
import { useSettings } from "../lib/settings.tsx";
import { lazyNamed } from "../lib/lazy-named.ts";
import { ErrorNotice } from "../ui/error-notice.tsx";
import type { NotificationsView } from "../lib/use-notifications.ts";
import { TopBar } from "./top-bar.tsx";

// The dialogs are rarely opened, so their code loads on first use and is fetched ahead once the page is idle.
const loadSettings = () => import("./settings-dialog.tsx");
const loadAccount = () => import("./account-dialog.tsx");
const SettingsDialog = lazyNamed(loadSettings, "SettingsDialog");
const AccountDialog = lazyNamed(loadAccount, "AccountDialog");

/** The settings could not load. The pages show the defaults until they do. */
function SettingsFailed() {
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  return (
    <ErrorNotice
      busy={busy}
      onRetry={() => {
        setBusy(true);
        void settings.reload().finally(() => setBusy(false));
      }}
    >
      Headroom could not load your settings, so the defaults are showing.
    </ErrorNotice>
  );
}

/** The frame around every signed-in page: top bar, page width, and the two dialogs the menu opens. */
export function Shell(props: {
  /** The view being shown, or null on the connect pages. */
  readonly view: ViewId | null;
  readonly name: string;
  readonly notifications: NotificationsView;
  /** Providers with a connected account, in the saved order, for the notification settings. */
  readonly providers: readonly Provider[];
  readonly children: ReactNode;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // A dialog is mounted from its first open on, so closing it keeps the exit and the focus return.
  const [settingsUsed, setSettingsUsed] = useState(false);
  const [accountUsed, setAccountUsed] = useState(false);
  const { loadFailed } = useSettings();
  useEffect(() => {
    const prefetch = (): void => {
      void loadSettings();
      void loadAccount();
    };
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(prefetch);
      return () => cancelIdleCallback(handle);
    }
    const handle = setTimeout(prefetch, 2000);
    return () => clearTimeout(handle);
  }, []);
  return (
    <div className="page">
      <TopBar
        view={props.view}
        name={props.name}
        notifications={props.notifications}
        onSettings={() => {
          setSettingsUsed(true);
          setSettingsOpen(true);
        }}
        onAccount={() => {
          setAccountUsed(true);
          setAccountOpen(true);
        }}
      />
      {loadFailed ? <SettingsFailed /> : null}
      {props.children}
      <Suspense fallback={null}>
        {settingsUsed ? (
          <SettingsDialog
            open={settingsOpen}
            providers={props.providers}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}
        {accountUsed ? (
          <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
        ) : null}
      </Suspense>
    </div>
  );
}
