import { useState, type ReactNode } from "react";

import { useSettings } from "../lib/settings.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import type { NotificationsView } from "../lib/use-notifications.ts";
import { AccountDialog } from "./account-dialog.tsx";
import { SettingsDialog } from "./settings-dialog.tsx";
import { TopBar } from "./top-bar.tsx";

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
  readonly onConnectPage: boolean;
  readonly name: string;
  readonly notifications: NotificationsView;
  readonly children: ReactNode;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { loadFailed } = useSettings();
  return (
    <div className="page">
      <TopBar
        onConnectPage={props.onConnectPage}
        name={props.name}
        notifications={props.notifications}
        onSettings={() => setSettingsOpen(true)}
        onAccount={() => setAccountOpen(true)}
      />
      {loadFailed ? <SettingsFailed /> : null}
      {props.children}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
