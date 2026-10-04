import { useEffect, useMemo, useState } from "react";

import type { OverviewConnection } from "../api.ts";
import {
  currentIds,
  deriveNotifications,
  loadRead,
  markAllRead,
  markRead,
  pruneRead,
  saveRead,
  type AppNotification,
  type ExpiringTopUp,
} from "@headroom/view-model/notifications";
import { browserStorage } from "./device-prefs.ts";
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

/**
 * Notifications for the current overview. Pass null until the overview has loaded, and `failed` when it could
 * not load. Nothing is derived before the settings are in either, so the badge never changes after it shows.
 * Pass `demoSeed` while Demo Mode is on: the read state then lives in memory for that seed alone, and the saved
 * read set is neither read nor changed. `topUps` are the Wallet top-ups that carry an expiry alert; pass null
 * until the Wallet has loaded, so the badge does not change after it shows.
 */
export function useNotifications(
  connections: readonly OverviewConnection[] | null,
  failed = false,
  demoSeed: number | null = null,
  topUps: readonly ExpiringTopUp[] | null = [],
): NotificationsView {
  const { settings, loaded } = useSettings();
  const ready = connections !== null && loaded && topUps !== null;
  const now = useNow();
  const [stored, setStored] = useState<ReadonlySet<string>>(() => {
    const store = browserStorage();
    return store === null ? new Set() : loadRead(store);
  });
  const [demoRead, setDemoRead] = useState<{
    readonly seed: number;
    readonly read: ReadonlySet<string>;
  } | null>(null);
  const demo = demoSeed !== null;
  const kept = demo ? (demoRead?.seed === demoSeed ? demoRead.read : noneRead) : stored;
  const derived = useMemo(
    () => (ready ? deriveNotifications(connections, settings, now, topUps) : []),
    [ready, connections, settings, now, topUps],
  );
  // Ids that no longer exist drop out of the read set; the stored copy catches up in an effect.
  const read = useMemo(
    () => (ready ? pruneRead(kept, currentIds(connections, settings, now, topUps)) : kept),
    [ready, connections, settings, now, topUps, kept],
  );
  useEffect(() => {
    if (demo || read.size === stored.size) return;
    const store = browserStorage();
    if (store !== null) saveRead(store, read);
  }, [demo, read, stored]);
  const update = (next: ReadonlySet<string>) => {
    if (demoSeed !== null) {
      setDemoRead({ seed: demoSeed, read: next });
      return;
    }
    setStored(next);
    const store = browserStorage();
    if (store !== null) saveRead(store, next);
  };
  const items = derived.map((item) => ({ ...item, read: read.has(item.id) }));
  return {
    status: ready ? "ready" : failed && connections === null ? "unavailable" : "loading",
    items,
    unread: items.filter((item) => !item.read).length,
    markRead: (id) => update(markRead(read, id)),
    markAllRead: () => update(markAllRead(read, derived)),
  };
}
