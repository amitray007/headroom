import { useCallback, useState } from "react";

import { browserStorage } from "../../lib/device-prefs.ts";

/**
 * Views remembered on this device, one key per choice. This file has no chart code, so the skeleton can read
 * the same choice the page will show.
 */

const storageKey = (key: string): string => `headroom.analytics.${key}`;

/** The stored view for `key`, or `fallback` when none is stored or the stored one is not in `views`. */
export function readStoredView<T extends string>(key: string, views: readonly T[], fallback: T): T {
  const saved = browserStorage()?.getItem(storageKey(key)) ?? null;
  return views.find((entry) => entry === saved) ?? fallback;
}

/** The view a card shows, remembered on this device. */
export function useStoredView<T extends string>(
  key: string,
  views: readonly T[],
  fallback: T,
): [T, (view: T) => void] {
  const [view, setView] = useState<T>(() => readStoredView(key, views, fallback));
  const choose = useCallback(
    (next: T) => {
      setView(next);
      try {
        browserStorage()?.setItem(storageKey(key), next);
      } catch {
        // Private browsing can refuse storage; the choice still holds for this visit.
      }
    },
    [key],
  );
  return [view, choose];
}
