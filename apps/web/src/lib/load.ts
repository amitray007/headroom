import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../api.ts";

export interface Loaded<T> {
  readonly data: T | null;
  readonly error: string | null;
  /** The HTTP status of the failure, when the server answered at all. */
  readonly status: number | null;
  /** True from the first request until it ends, and again during every reload. Data stays while it reloads. */
  readonly pending: boolean;
  readonly reload: () => void;
}

/** Load once per key and on demand; failures become a message, never an exception. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [pending, setPending] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const guard = { live: true };
    setPending(true);
    void (async () => {
      try {
        const value = await load();
        if (!guard.live) return;
        setData(value);
        setError(null);
        setStatus(null);
      } catch (cause) {
        if (guard.live) {
          setError(messageOf(cause));
          setStatus(cause instanceof ApiError ? cause.status : null);
        }
      }
      if (guard.live) setPending(false);
    })();
    return () => {
      guard.live = false;
    };
    // `load` is a fresh closure each render; `key` and `tick` decide when to reload.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, status, pending, reload };
}

export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Request failed";
}
