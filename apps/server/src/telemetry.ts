import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Fetch, post } from "./notify/http.ts";

/**
 * Anonymous usage pings to PostHog (ADR 0007). One `install_active` event a day and at most one
 * `opened` event an hour. Every property is listed in `dailyProperties` and `openedProperties`;
 * nothing else leaves the server. A failed send is dropped and never retried.
 */

/** PostHog's public project key: it can only write events. Empty sends nothing. */
const posthogKey = "";
export const posthogUrl = "https://us.i.posthog.com/i/v0/e/";

const hour = 60 * 60_000;
const day = 24 * hour;

/** Where the owner looked at Headroom: the web dashboard, the Mac app feed, or an MCP agent. */
export type Surface = "web" | "mac" | "mcp";

interface DailyFacts {
  readonly version: string;
  readonly platform: string;
  readonly arch: string;
  readonly install: string;
  /** Linked accounts per provider. Counts only, never which accounts. */
  readonly accounts: Readonly<Record<string, number>>;
}

export interface TelemetryOptions {
  readonly fetch: Fetch;
  readonly now: () => Date;
  /** Both the owner setting and HEADROOM_TELEMETRY must allow it. Read at send time. */
  readonly enabled: () => boolean;
  readonly installId: () => string;
  readonly facts: () => DailyFacts;
  readonly key?: string;
  readonly log?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

const anonymous = { $process_person_profile: false, $geoip_disable: true } as const;

function dailyProperties(facts: DailyFacts): Record<string, unknown> {
  return {
    ...anonymous,
    version: facts.version,
    os: `${facts.platform}-${facts.arch}`,
    install: facts.install,
    accounts: facts.accounts,
    account_total: Object.values(facts.accounts).reduce((sum, n) => sum + n, 0),
  };
}

function openedProperties(version: string, surfaces: readonly Surface[]): Record<string, unknown> {
  return { ...anonymous, version, surfaces: surfaces.toSorted() };
}

export class TelemetryService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDailyAt: number | null = null;
  private viewed = new Set<Surface>();
  private readonly key: string;

  constructor(private readonly deps: TelemetryOptions) {
    this.key = deps.key ?? posthogKey;
  }

  /** Check now, then every hour until `stop`. */
  start(): void {
    if (this.timer) return;
    const run = (): void => {
      // An unwritable data directory makes the install ID throw; the ping is skipped, nothing else.
      this.tick().catch(() => this.deps.log?.("debug", "usage ping skipped: no install ID"));
    };
    this.timer = setInterval(run, hour);
    run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Remember that a surface read the dashboard since the last hourly check. */
  markViewed(surface: Surface): void {
    this.viewed.add(surface);
  }

  /** Send the daily event when a day has passed, and `opened` when anything was viewed. */
  async tick(): Promise<void> {
    if (!this.key || !this.deps.enabled()) {
      this.viewed.clear();
      return;
    }
    const at = this.deps.now().getTime();
    const facts = this.deps.facts();
    if (this.lastDailyAt === null || at - this.lastDailyAt >= day) {
      this.lastDailyAt = at;
      await this.send("install_active", dailyProperties(facts));
    }
    if (this.viewed.size > 0) {
      const surfaces = [...this.viewed];
      this.viewed.clear();
      await this.send("opened", openedProperties(facts.version, surfaces));
    }
  }

  private async send(event: string, properties: Record<string, unknown>): Promise<void> {
    const body = JSON.stringify({
      api_key: this.key,
      event,
      distinct_id: this.deps.installId(),
      properties,
    });
    const result = await post(
      this.deps.fetch,
      posthogUrl,
      { "content-type": "application/json" },
      body,
    );
    const status = typeof result === "string" ? result : result.ok ? null : `HTTP ${result.status}`;
    if (status) this.deps.log?.("debug", `usage ping ${event} not sent: ${status}`);
  }
}

/** A random ID kept in the data directory, so a restart counts as the same install. */
export function loadOrCreateInstallId(dataDir: string): string {
  const path = join(dataDir, "install-id");
  if (existsSync(path)) {
    const saved = readFileSync(path, "utf8").trim();
    if (saved) return saved;
  }
  const id = randomUUID();
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${id}\n`, { mode: 0o600 });
  return id;
}
