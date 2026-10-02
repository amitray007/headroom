import type {
  AttemptStore,
  CollectionService,
  ConnectionStore,
  SnapshotStore,
} from "@headroom/core";

/**
 * Periodic tick: expire overdue attempts, then collect every connection that is due.
 * Due means no run yet, a Retry-After that has passed, or the interval plus a
 * per-connection jitter elapsed since the last run started. One connection at a time.
 */
export interface SchedulerOptions {
  readonly connections: ConnectionStore;
  readonly attempts: AttemptStore;
  readonly snapshots: SnapshotStore;
  readonly collection: CollectionService;
  /** A getter lets a settings change apply at the next tick without a restart. */
  readonly intervalMs: number | (() => number);
  readonly tickMs?: number;
  /** Runs after each tick that did its work, for example to deliver notifications. Its failure never stops the scheduler. */
  readonly afterTick?: (now: number) => Promise<void> | void;
  readonly now?: () => Date;
  readonly log?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly now: () => Date;

  constructor(private readonly deps: SchedulerOptions) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.tickMs ?? 30_000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Returns the ids collected. Re-entrant calls are skipped. */
  async tick(): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    const collected: string[] = [];
    try {
      const expired = this.deps.attempts.expireOverdue();
      if (expired.length > 0) this.deps.log?.("info", `expired ${expired.length} attempt(s)`);
      for (const connection of this.deps.connections.list()) {
        if (connection.state !== "ready" && connection.state !== "partial") continue;
        if (!this.isDue(connection.id)) continue;
        // Sequential on purpose: one provider request at a time keeps rate limits predictable.
        // eslint-disable-next-line no-await-in-loop -- collections must not run concurrently
        const outcome = await this.deps.collection.run(connection.id, `scheduler:${connection.id}`);
        this.deps.log?.("debug", `collected ${connection.id}: ${outcome.status}`);
        if (outcome.status === "collected" || outcome.status === "failed")
          collected.push(connection.id);
      }
    } finally {
      this.running = false;
    }
    await this.runAfterTick();
    return collected;
  }

  private async runAfterTick(): Promise<void> {
    if (!this.deps.afterTick) return;
    try {
      await this.deps.afterTick(this.now().getTime());
    } catch (error) {
      // The class only: the message could carry a URL with a secret in it.
      this.deps.log?.(
        "error",
        `after-tick hook failed: ${error instanceof Error ? error.name : "unknown"}`,
      );
    }
  }

  isDue(connectionId: string): boolean {
    const run = this.deps.snapshots.latestRun(connectionId);
    if (!run) return true;
    if (!run.finishedAt) return false;
    const now = this.now().getTime();
    if (run.retryAfter) return now >= run.retryAfter.getTime();
    const { intervalMs } = this.deps;
    const interval = typeof intervalMs === "function" ? intervalMs() : intervalMs;
    return now - run.startedAt.getTime() >= interval + jitter(connectionId, interval);
  }
}

/** Deterministic 0 to 10 percent of the interval so connections do not all fire together. */
function jitter(id: string, intervalMs: number): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return Math.floor(((hash % 1000) / 1000) * intervalMs * 0.1);
}
