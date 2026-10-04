import type {
  AttemptStore,
  CollectionService,
  ConnectionStore,
  ConnectService,
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
  /** Expires overdue attempts, so a connector can remove what a half-finished sign-in left behind. */
  readonly connect: Pick<ConnectService, "expire">;
  readonly snapshots: SnapshotStore;
  readonly collection: CollectionService;
  /** Account events, pruned with the same cutoff as snapshots. */
  readonly events?: { prune(cutoff: Date): number };
  /**
   * Runs after a collection that succeeded, for example the auto-reset rule. Its failure is
   * logged by class and never stops the other connections.
   */
  readonly afterCollect?: (connectionId: string, now: number) => Promise<unknown>;
  /** A getter lets a settings change apply at the next tick without a restart. */
  readonly intervalMs: number | (() => number);
  readonly tickMs?: number;
  /** Runs after each tick that did its work, for example to deliver notifications. Its failure never stops the scheduler. */
  readonly afterTick?: (now: number) => Promise<void> | void;
  /** Days of history to keep. A getter, so a settings change applies at the next prune. Absent means never prune. */
  readonly retentionDays?: () => number;
  readonly now?: () => Date;
  readonly log?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

/** How often old history is pruned. The first prune runs on the first tick after startup. */
export const pruneEveryMs = 6 * 60 * 60_000;

const dayMs = 86_400_000;

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopped = false;
  private current: Promise<string[]> | null = null;
  private lastPruneAt: number | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: SchedulerOptions) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    const run = (): void => {
      this.tick().catch((error: unknown) =>
        this.deps.log?.("error", `tick failed: ${errorClass(error)}`),
      );
    };
    this.timer = setInterval(run, this.deps.tickMs ?? 30_000);
    run();
  }

  /** Stop scheduling. Resolves when the tick in flight, if any, has finished its current connection. */
  stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return (this.current ?? Promise.resolve()).then(
      () => undefined,
      () => undefined,
    );
  }

  /** One pass. Returns the ids collected. Re-entrant calls are skipped. */
  async tick(): Promise<string[]> {
    if (this.running) return [];
    this.running = true;
    const pass = this.pass();
    this.current = pass;
    try {
      return await pass;
    } finally {
      this.running = false;
      this.current = null;
    }
  }

  private async pass(): Promise<string[]> {
    const collected: string[] = [];
    try {
      for (const id of this.deps.attempts.listOverdue()) {
        try {
          // eslint-disable-next-line no-await-in-loop -- one connector cleanup at a time
          await this.deps.connect.expire(id);
          this.deps.log?.("info", `expired attempt ${id}`);
        } catch (error) {
          this.deps.log?.("error", `expiring attempt ${id} failed: ${errorClass(error)}`);
        }
      }
      for (const connection of this.deps.connections.list()) {
        if (this.stopped) break;
        // One connection failing (deleted mid-tick, a decrypt error) must not skip the others.
        try {
          if (connection.state !== "ready" && connection.state !== "partial") continue;
          if (!this.isDue(connection.id)) continue;
          // Sequential on purpose: one provider request at a time keeps rate limits predictable.
          // eslint-disable-next-line no-await-in-loop -- collections must not run concurrently
          const outcome = await this.deps.collection.run(
            connection.id,
            `scheduler:${connection.id}`,
          );
          this.deps.log?.("debug", `collected ${connection.id}: ${outcome.status}`);
          if (outcome.status === "collected" || outcome.status === "failed")
            collected.push(connection.id);
          if (outcome.status === "collected" && this.deps.afterCollect) {
            try {
              // eslint-disable-next-line no-await-in-loop -- a rule may act on the account before the next one is collected
              await this.deps.afterCollect(connection.id, this.now().getTime());
            } catch (error) {
              this.deps.log?.("error", `after-collect hook failed: ${errorClass(error)}`);
            }
          }
        } catch (error) {
          // The class only: the message could carry provider text.
          this.deps.log?.("error", `collecting ${connection.id} failed: ${errorClass(error)}`);
        }
      }
    } finally {
      await this.runAfterTick();
    }
    return collected;
  }

  /** Delete history past the retention period, at most every six hours. Logs counts only and never throws. */
  private prune(): void {
    const days = this.deps.retentionDays;
    if (!days) return;
    const now = this.now().getTime();
    if (this.lastPruneAt !== null && now - this.lastPruneAt < pruneEveryMs) return;
    // Set before the work, so a failing prune waits for the next window instead of every tick.
    this.lastPruneAt = now;
    try {
      const cutoff = new Date(now - days() * dayMs);
      const pruned = this.deps.snapshots.prune(cutoff);
      const events = this.deps.events?.prune(cutoff) ?? 0;
      this.deps.log?.(
        "info",
        `pruned history: ${pruned.snapshots} snapshots, ${pruned.syncRuns} runs, ${events} events`,
      );
    } catch (error) {
      this.deps.log?.("error", `history prune failed: ${errorClass(error)}`);
    }
  }

  private async runAfterTick(): Promise<void> {
    this.prune();
    if (!this.deps.afterTick) return;
    try {
      await this.deps.afterTick(this.now().getTime());
    } catch (error) {
      // The class only: the message could carry a URL with a secret in it.
      this.deps.log?.("error", `after-tick hook failed: ${errorClass(error)}`);
    }
  }

  isDue(connectionId: string): boolean {
    const run = this.deps.snapshots.latestRun(connectionId);
    if (!run) return true;
    const now = this.now().getTime();
    // An open run is in progress, unless it is older than a lease lasts: its owner is gone.
    if (!run.finishedAt) return now - run.startedAt.getTime() >= this.deps.collection.leaseTtlMs;
    if (run.retryAfter) return now >= run.retryAfter.getTime();
    const { intervalMs } = this.deps;
    const interval = typeof intervalMs === "function" ? intervalMs() : intervalMs;
    return now - run.startedAt.getTime() >= interval + jitter(connectionId, interval);
  }
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/** Deterministic 0 to 10 percent of the interval so connections do not all fire together. */
function jitter(id: string, intervalMs: number): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return Math.floor(((hash % 1000) / 1000) * intervalMs * 0.1);
}
