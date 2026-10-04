import { useSyncExternalStore } from "react";

/** One shared clock for every time label. A 30 second tick is enough for minute wording. */
const tickMs = 30_000;

let current = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of listeners) notify();
    }, tickMs);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function snapshot(): number {
  // With no ticker running the stored value goes stale, so refresh it once a second at most.
  if (timer === null && Date.now() - current > 1000) current = Date.now();
  return current;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
