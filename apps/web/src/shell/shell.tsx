import { useState, type ReactNode } from "react";

import type { ViewId } from "../router.ts";
import { useSettings } from "../lib/settings.tsx";
import type { ViewProps } from "../views/props.ts";
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
  /** The view being shown, or null on the connect pages. */
  readonly view: ViewId | null;
  readonly name: string;
  readonly notifications: NotificationsView;
  /** The settings dialog orders the providers the overview holds. */
  readonly overview: ViewProps["overview"];
  readonly children: ReactNode;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const { loadFailed } = useSettings();
  return (
    <div className="page">
      <TopBar
        view={props.view}
        name={props.name}
        notifications={props.notifications}
        onSettings={() => setSettingsOpen(true)}
        onAccount={() => setAccountOpen(true)}
      />
      {loadFailed ? <SettingsFailed /> : null}
      {props.children}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        overview={props.overview}
      />
      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
