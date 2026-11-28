import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Fetch, post } from "./notify/http.ts";

/**
 * Anonymous usage pings to PostHog (ADR 0007). Once a day: `install_active`, one `provider_daily`
 * per provider in use, and one `connect_result` per finished sign-in. At most hourly: `opened`.
 * On the owner's press: `feedback`. Every property is built in this file; nothing else leaves the
 * server. A failed send is dropped and never retried.
 */

/** PostHog's public project key: it can only write events. Empty sends nothing. */
const posthogKey = "";
/**
 * PostHog's managed reverse proxy on a neutral subdomain, so DNS blocklists that list
 * posthog.com do not drop the events (docs/operations/usage-stats.md).
 */
export const posthogUrl = "https://hd.headroom.theblank.club/batch/";
/** More sign-ins than this in a day are not reported one by one. */
const connectEventCap = 50;

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

export interface ConnectCount {
  readonly provider: string;
  readonly method: string;
  readonly state: string;
  readonly count: number;
}

export interface RefreshCount {
  readonly provider: string;
  readonly outcome: string;
  readonly count: number;
}

/** Everything the daily events report. Every value is a count, a flag or an enum value. */
export interface DailyFacts {
  readonly platform: string;
  readonly arch: string;
  readonly install: string;
  /** Linked accounts per provider. Counts only, never which accounts. */
  readonly accounts: Readonly<Record<string, number>>;
  /** Sign-in attempts that finished since the last daily events. */
  readonly connects: readonly ConnectCount[];
  /** Refreshes that finished since the last daily events. */
  readonly refreshes: readonly RefreshCount[];
  /** Which owner features are in use; each key is sent as `feature_<key>`. */
  readonly features: Readonly<Record<string, number | boolean>>;
}

type Properties = Record<string, unknown>;
type Event = { readonly event: string; readonly properties: Properties };

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

function installEvent(version: string, facts: DailyFacts, clients: readonly string[]): Event {
  const features = Object.fromEntries(
    Object.entries(facts.features).map(([key, value]) => [`feature_${key}`, value]),
  );
  return {
    event: "install_active",
    properties: {
      version,
      os: `${facts.platform}-${facts.arch}`,
      install: facts.install,
      account_total: Object.values(facts.accounts).reduce((sum, n) => sum + n, 0),
      providers: Object.keys(facts.accounts).toSorted(),
      mac_clients: clients.toSorted(),
      ...features,
    },
  };
}

/** One event per provider that has accounts or refreshed, so PostHog can break down by provider. */
function providerEvents(version: string, facts: DailyFacts): Event[] {
  const providers = new Set([
    ...Object.keys(facts.accounts),
    ...facts.refreshes.map((row) => row.provider),
  ]);
  return [...providers].toSorted().map((provider) => {
    const rows = facts.refreshes.filter((row) => row.provider === provider);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const succeeded = rows.find((row) => row.outcome === "succeeded")?.count ?? 0;
    return {
      event: "provider_daily",
      properties: {
        version,
        provider,
        accounts: facts.accounts[provider] ?? 0,
        refreshes: total,
        refresh_failed: total - succeeded,
        ...Object.fromEntries(rows.map((row) => [`refresh_${row.outcome}`, row.count])),
      },
    };
  });
}

/** One event per finished sign-in, up to a daily cap, so counts and rates need no sum. */
function connectEvents(version: string, connects: readonly ConnectCount[]): Event[] {
  const events = connects.flatMap((row) =>
    Array.from({ length: row.count }, () => ({
      event: "connect_result",
      properties: { version, provider: row.provider, method: row.method, state: row.state },
    })),
  );
  return events.slice(0, connectEventCap);
}

function openedEvent(
  version: string,
  surfaces: readonly Surface[],
  views: readonly UsageView[],
): Event {
  return {
    event: "opened",
    properties: { version, surfaces: surfaces.toSorted(), views: views.toSorted() },
  };
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
    const sent = await this.send([
      { event: "feedback", properties: { version: this.deps.version, message } },
    ]);
    return sent ? "sent" : "failed";
  }

  /** Send the daily events when a day has passed, and `opened` when anything was viewed. */
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
      const { version } = this.deps;
      await this.send([
        installEvent(version, facts, clients),
        ...providerEvents(version, facts),
        ...connectEvents(version, facts.connects),
      ]);
    }
    if (this.viewed.size > 0) {
      const opened = openedEvent(this.deps.version, [...this.viewed], [...this.views]);
      this.viewed.clear();
      this.views.clear();
      await this.send([opened]);
    }
  }

  private forget(): void {
    this.viewed.clear();
    this.views.clear();
    this.clients.clear();
  }

  /** One request to PostHog's batch route. Every event is anonymous: no person profile, no GeoIP. */
  private async send(events: readonly Event[]): Promise<boolean> {
    const distinctId = this.deps.installId();
    const body = JSON.stringify({
      api_key: this.key,
      batch: events.map(({ event, properties }) => ({
        event,
        distinct_id: distinctId,
        properties: { ...properties, ...anonymous },
      })),
    });
    const result = await post(
      this.deps.fetch,
      posthogUrl,
      { "content-type": "application/json" },
      body,
    );
    const status = typeof result === "string" ? result : result.ok ? null : `HTTP ${result.status}`;
    if (status) this.deps.log?.("debug", `usage ping not sent: ${status}`);
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
