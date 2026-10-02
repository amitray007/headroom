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
} from "./notifications.ts";
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

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Notifications for the current overview. Pass null until the overview has loaded, and `failed` when it could
 * not load. Nothing is derived before the settings are in either, so the badge never changes after it shows.
 */
export function useNotifications(
  connections: readonly OverviewConnection[] | null,
  failed = false,
): NotificationsView {
  const { settings, loaded } = useSettings();
  const ready = connections !== null && loaded;
  const now = useNow();
  const [stored, setStored] = useState<ReadonlySet<string>>(() => {
    const store = storage();
    return store === null ? new Set() : loadRead(store);
  });
  const derived = useMemo(
    () => (ready ? deriveNotifications(connections, settings, now) : []),
    [ready, connections, settings, now],
  );
  // Ids that no longer exist drop out of the read set; the stored copy catches up in an effect.
  const read = useMemo(
    () => (ready ? pruneRead(stored, currentIds(connections, settings, now)) : stored),
    [ready, connections, settings, now, stored],
  );
  useEffect(() => {
    if (read.size === stored.size) return;
    const store = storage();
    if (store !== null) saveRead(store, read);
  }, [read, stored]);
  const update = (next: ReadonlySet<string>) => {
    setStored(next);
    const store = storage();
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
