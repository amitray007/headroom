import { useCallback, useEffect, useState } from "react";

export interface Loaded<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly reload: () => void;
}

/** Load once per key and on demand; failures become a message, never an exception. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const guard = { live: true };
    void (async () => {
      try {
        const value = await load();
        if (!guard.live) return;
        setData(value);
        setError(null);
      } catch (cause) {
        if (guard.live) setError(messageOf(cause));
      }
    })();
    return () => {
      guard.live = false;
    };
    // `load` is a fresh closure each render; `key` and `tick` decide when to reload.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, reload };
}

/** Current time that re-renders every `intervalMs`. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Request failed";
}
