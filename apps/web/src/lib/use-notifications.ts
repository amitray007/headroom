import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { api, type OverviewConnection } from "../api.ts";
import {
  currentIds,
  deriveNotifications,
  markAllRead,
  markRead,
  pruneRead,
  type AppNotification,
  type ExpiringTopUp,
} from "@headroom/view-model/notifications";
import { browserStorage } from "./device-prefs.ts";
import { createNoticeReadStore, type NoticeReadStore } from "./notice-read-store.ts";
import { useNow } from "./now.ts";
import { useSettings } from "./settings.tsx";

interface NotificationItem extends AppNotification {
  readonly read: boolean;
}

export interface NotificationsView {
  /** Loading until the overview and the settings are in; unavailable when the overview could not load. */
  readonly status: "loading" | "ready" | "unavailable";
  readonly items: readonly NotificationItem[];
  readonly unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const noneRead: ReadonlySet<string> = new Set();

let shared: NoticeReadStore | null = null;

/** One read store for the page: the owner's read marks live on the server. */
function readStore(): NoticeReadStore {
  shared ??= createNoticeReadStore(api, browserStorage());
  return shared;
}

/**
 * Notifications for the current overview. Pass null until the overview has loaded, and `failed` when it could
 * not load. Nothing is derived before the settings are in either, so the badge never changes after it shows.
 * The read marks come from the server and are shared with the Mac app. Pass `demoSeed` while Demo Mode is on:
 * the read state then lives in memory for that seed alone, and the server is neither read nor changed. `topUps`
 * are the Wallet top-ups that carry an expiry alert; pass null until the Wallet has loaded, so the badge does
 * not change after it shows.
 */
export function useNotifications(
  connections: readonly OverviewConnection[] | null,
  failed = false,
  demoSeed: number | null = null,
  topUps: readonly ExpiringTopUp[] | null = [],
): NotificationsView {
  const { settings, loaded } = useSettings();
  const demo = demoSeed !== null;
  const store = readStore();
  const server = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => (demo ? undefined : store.attach()), [demo, store]);
  const ready = connections !== null && loaded && topUps !== null && (demo || server.loaded);
  const now = useNow();
  const [demoRead, setDemoRead] = useState<{
    readonly seed: number;
    readonly read: ReadonlySet<string>;
  } | null>(null);
  const kept = demo ? (demoRead?.seed === demoSeed ? demoRead.read : noneRead) : server.read;
  const derived = useMemo(
    () => (ready ? deriveNotifications(connections, settings, now, topUps) : []),
    [ready, connections, settings, now, topUps],
  );
  // Ids that no longer exist drop out of what is shown. The server forgets old marks by itself.
  const read = useMemo(
    () => (ready ? pruneRead(kept, currentIds(connections, settings, now, topUps)) : kept),
    [ready, connections, settings, now, topUps, kept],
  );
  const update = (ids: readonly string[], next: ReadonlySet<string>) => {
    if (demoSeed !== null) setDemoRead({ seed: demoSeed, read: next });
    else store.mark(ids, true);
  };
  const items = derived.map((item) => ({ ...item, read: read.has(item.id) }));
  return {
    status: ready ? "ready" : failed && connections === null ? "unavailable" : "loading",
    items,
    unread: items.filter((item) => !item.read).length,
    markRead: (id) => update([id], markRead(read, id)),
    markAllRead: () =>
      update(
        derived.map((item) => item.id),
        markAllRead(read, derived),
      ),
  };
}
