import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Fetch, post } from "./notify/http.ts";

/**
 * Anonymous usage pings to PostHog (ADR 0007). One `install_active` event a day, at most one
 * `opened` event an hour, and a `feedback` event when the owner sends one. Every property is
 * listed in `dailyProperties`, `openedProperties` and `sendFeedback`; nothing else leaves the
 * server. A failed send is dropped and never retried.
 */

/** PostHog's public project key: it can only write events. Empty sends nothing. */
const posthogKey = "";
export const posthogUrl = "https://us.i.posthog.com/i/v0/e/";

const hour = 60 * 60_000;
const day = 24 * hour;

/** Where the owner looked at Headroom: the web dashboard, the Mac app feed, or an MCP agent. */
export type Surface = "web" | "mac" | "mcp";

/** Dashboard pages the web app reports when the owner opens them. */
export const usageViews = [
  "overview",
  "detailed",
  "compare",
  "timeline",
  "wallet",
  "analytics",
  "connect",
] as const;
export type UsageView = (typeof usageViews)[number];

/** Longest feedback message, in characters. */
export const feedbackMaxLength = 2000;

type Counts = Readonly<Record<string, number>>;

/** Everything the daily event reports. Every value is a count, a flag or an enum value. */
export interface DailyFacts {
  readonly platform: string;
  readonly arch: string;
  readonly install: string;
  /** Linked accounts per provider. Counts only, never which accounts. */
  readonly accounts: Counts;
  /** Finished sign-in attempts since the last daily event, by `provider.method.state`. */
  readonly connects: Counts;
  /** Finished refreshes since the last daily event, by `provider.outcome`. */
  readonly refreshes: Counts;
  /** Which owner features are in use. */
  readonly features: Readonly<Record<string, number | boolean>>;
}

export interface TelemetryOptions {
  readonly version: string;
  readonly fetch: Fetch;
  readonly now: () => Date;
  /** Both the owner setting and HEADROOM_TELEMETRY must allow it. Read at send time. */
  readonly enabled: () => boolean;
  readonly installId: () => string;
  /** The daily facts; `since` is when the last daily event went out, or a day ago. */
  readonly facts: (since: number) => DailyFacts;
  readonly key?: string;
  readonly log?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

const anonymous = { $process_person_profile: false, $geoip_disable: true } as const;

function dailyProperties(
  version: string,
  facts: DailyFacts,
  clients: readonly string[],
): Record<string, unknown> {
  return {
    ...anonymous,
    version,
    os: `${facts.platform}-${facts.arch}`,
    install: facts.install,
    accounts: facts.accounts,
    account_total: Object.values(facts.accounts).reduce((sum, n) => sum + n, 0),
    connects: facts.connects,
    refreshes: facts.refreshes,
    features: facts.features,
    mac_clients: clients.toSorted(),
  };
}

function openedProperties(
  version: string,
  surfaces: readonly Surface[],
  views: readonly UsageView[],
): Record<string, unknown> {
  return { ...anonymous, version, surfaces: surfaces.toSorted(), views: views.toSorted() };
}

/**
 * The app name and version from a Mac client's User-Agent, such as `Headroom/1.2.0` or
 * `HeadroomWidgets/1.2.0`. Anything else, including the CFNetwork and Darwin parts, is dropped.
 */
export function macClientOf(userAgent: string | undefined): string | null {
  const match = /^(Headroom[A-Za-z-]{0,24})\/([0-9][0-9A-Za-z.-]{0,23})(?:\s|$)/.exec(
    userAgent ?? "",
  );
  return match ? `${match[1]}/${match[2]}` : null;
}

export class TelemetryService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDailyAt: number | null = null;
  private viewed = new Set<Surface>();
  private views = new Set<UsageView>();
  private clients = new Set<string>();
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

  /** Remember a dashboard page the web app opened. */
  markView(view: UsageView): void {
    this.views.add(view);
  }

  /** Remember a Mac app or widget version that read the feed, until the next daily event. */
  markClient(userAgent: string | undefined): void {
    const client = macClientOf(userAgent);
    if (client && this.clients.size < 20) this.clients.add(client);
  }

  /**
   * Send the owner's message. It is an explicit press, so it goes out with usage stats off; only a
   * missing project key stops it. The message is sent as typed, with the version and nothing else.
   */
  async sendFeedback(message: string): Promise<"sent" | "unavailable" | "failed"> {
    if (!this.key) return "unavailable";
    const sent = await this.send("feedback", { ...anonymous, version: this.deps.version, message });
    return sent ? "sent" : "failed";
  }

  /** Send the daily event when a day has passed, and `opened` when anything was viewed. */
  async tick(): Promise<void> {
    if (!this.key || !this.deps.enabled()) {
      this.forget();
      return;
    }
    const at = this.deps.now().getTime();
    if (this.lastDailyAt === null || at - this.lastDailyAt >= day) {
      const facts = this.deps.facts(this.lastDailyAt ?? at - day);
      this.lastDailyAt = at;
      const clients = [...this.clients];
      this.clients.clear();
      await this.send("install_active", dailyProperties(this.deps.version, facts, clients));
    }
    if (this.viewed.size > 0) {
      const opened = openedProperties(this.deps.version, [...this.viewed], [...this.views]);
      this.viewed.clear();
      this.views.clear();
      await this.send("opened", opened);
    }
  }

  private forget(): void {
    this.viewed.clear();
    this.views.clear();
    this.clients.clear();
  }

  private async send(event: string, properties: Record<string, unknown>): Promise<boolean> {
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
    return status === null;
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
