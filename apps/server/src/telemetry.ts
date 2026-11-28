import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { UsageAction, UsageView } from "@headroom/core/contracts";

import { type Fetch, post } from "./notify/http.ts";
import { compareVersions, type InstallKind } from "./update.ts";

/**
 * Anonymous usage pings to PostHog (ADR 0007). Once a day: `install_active`, one `provider_daily`
 * per provider in use, and one `connect_result` per finished sign-in. At most hourly: `opened`.
 * On the owner's press: `feedback`. Every property is built in this file; nothing else leaves the
 * server. A failed send is dropped and never retried.
 */

/** PostHog's public project key: it can only write events. Empty sends nothing. */
const posthogKey = "phc_mFhU4x7B3Ze55gPVQJozu9tpkEzTtUh3kBdq2PtDi2uN";
/**
 * PostHog's managed reverse proxy on our own subdomain, so DNS blocklists that list
 * posthog.com do not drop the events (docs/operations/usage-stats.md).
 */
export const posthogUrl = "https://hd.headroom.theblank.club/batch/";
/** More occurrences of one event than this in a day are not reported one by one. */
const occurrenceCap = 50;
/** More Mac app and widget versions than this in a day are not listed. */
const macClientCap = 20;
/** The least time between two feedback messages. */
const feedbackCooldownMs = 30_000;

const hour = 60 * 60_000;
const day = 24 * hour;

/** Where the owner looked at Headroom: the web dashboard, the Mac app feed, or an MCP agent. */
export type Surface = "web" | "mac" | "mcp";

export type ConnectCount = {
  readonly provider: string;
  readonly method: string;
  readonly state: string;
  readonly count: number;
};

export type RefreshCount = {
  readonly provider: string;
  readonly outcome: string;
  readonly count: number;
};

export type ActionCount = {
  readonly provider: string;
  readonly action: string;
  readonly origin: string;
  readonly state: string;
  readonly count: number;
};

export type DeliveryCount = {
  readonly channel: string;
  readonly status: string;
  readonly failure: string | null;
  readonly count: number;
};

/** A grouped count. Every other field is a fixed enum value sent as an event property. */
type Counted = { readonly count: number } & Readonly<Record<string, string | number | null>>;

/** Everything the daily events report. Every value is a count, a flag or an enum value. */
export interface DailyFacts {
  readonly platform: string;
  readonly arch: string;
  readonly install: InstallKind;
  /** Linked accounts per provider. Counts only, never which accounts. */
  readonly accounts: Readonly<Record<string, number>>;
  /** Sign-in attempts that finished since the last daily events. */
  readonly connects: readonly ConnectCount[];
  /** Refreshes that finished since the last daily events. */
  readonly refreshes: readonly RefreshCount[];
  /** Account actions, pressed or automatic, that ended since the last daily events. */
  readonly actions: readonly ActionCount[];
  /** Notification sends last tried since the last daily events. */
  readonly deliveries: readonly DeliveryCount[];
  /** The newest release the update notice knows of, or null before its first check. */
  readonly latestVersion: string | null;
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
  /** The daily facts for activity that finished at or after `since`. */
  readonly facts: (since: number) => DailyFacts;
  /**
   * When activity was last reported, or last kept back because usage stats were off. Kept on disk
   * so a restart or a switch back on never reports the same or an opted-out period.
   */
  readonly watermark: { read(): number | null; write(at: number): void };
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
      latest_version: facts.latestVersion,
      update_available:
        facts.latestVersion !== null && compareVersions(facts.latestVersion, version) > 0,
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

/** One event per occurrence, up to a daily cap, so counts and rates need no sum. */
function occurrenceEvents(event: string, version: string, rows: readonly Counted[]): Event[] {
  const events: Event[] = [];
  for (const { count, ...fields } of rows) {
    const properties = { version, ...fields };
    const room = Math.min(count, occurrenceCap - events.length);
    for (let i = 0; i < room; i++) events.push({ event, properties });
  }
  return events;
}

/** One event per group with its `count`, for results too frequent to send one by one. */
function countedEvents(event: string, version: string, rows: readonly Counted[]): Event[] {
  return rows.map((row) => ({ event, properties: { version, ...row } }));
}

function openedEvent(
  version: string,
  surfaces: readonly Surface[],
  views: readonly UsageView[],
  actions: readonly UsageAction[],
): Event {
  return {
    event: "opened",
    properties: {
      version,
      surfaces: surfaces.toSorted(),
      views: views.toSorted(),
      actions: actions.toSorted(),
    },
  };
}

/**
 * Where a server error happened and its class, from an error log line such as `tick failed: TypeError`
 * or `GET /api/x: RangeError`. Only the first word and the class name are kept; ids and paths are not.
 */
export function errorOf(message: string): { where: string; error: string } {
  const name = /: ([A-Za-z]{1,40})$/.exec(message)?.[1] ?? "unknown";
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.test(message)) {
    return { where: "request", error: name };
  }
  const first = /^([a-z][a-z-]{0,30})\b/.exec(message)?.[1];
  return { where: first ?? "other", error: name };
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
  private surfaces = new Set<Surface>();
  private views = new Set<UsageView>();
  private actions = new Set<UsageAction>();
  private errors = new Map<string, { where: string; error: string; count: number }>();
  private clients = new Set<string>();
  private lastFeedbackAt: number | null = null;
  private wasOff = false;
  private readonly key: string;

  constructor(private readonly deps: TelemetryOptions) {
    this.key = deps.key ?? posthogKey;
  }

  /** Check now, then every hour until `stop`. */
  start(): void {
    if (this.timer) return;
    const run = (): void => {
      this.tick().catch((error: unknown) =>
        this.deps.log?.(
          "debug",
          `usage ping skipped: ${error instanceof Error ? error.name : "error"}`,
        ),
      );
    };
    this.timer = setInterval(run, hour);
    run();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Remember that a surface (web, Mac app, MCP) read the dashboard since the last hourly check. */
  markSurface(surface: Surface): void {
    this.surfaces.add(surface);
  }

  markView(view: UsageView): void {
    this.views.add(view);
  }

  markAction(action: UsageAction): void {
    this.actions.add(action);
  }

  /** Count an error-level log line by where and class, until the next daily events. */
  countError(message: string): void {
    const { where, error } = errorOf(message);
    const key = `${where}:${error}`;
    const seen = this.errors.get(key);
    if (seen) seen.count += 1;
    else if (this.errors.size < occurrenceCap) this.errors.set(key, { where, error, count: 1 });
  }

  /** Remember a Mac app or widget version that read the feed, until the next daily event. */
  markClient(userAgent: string | undefined): void {
    const client = macClientOf(userAgent);
    if (client && this.clients.size < macClientCap) this.clients.add(client);
  }

  /**
   * Send the owner's message. It is an explicit press, so it goes out with usage stats off; then it
   * carries a one-off ID instead of the install ID, so it cannot be joined to earlier events. The
   * message is sent as typed, with the version and nothing else.
   */
  async sendFeedback(message: string): Promise<"sent" | "unavailable" | "too_soon" | "failed"> {
    if (!this.key) return "unavailable";
    const at = this.deps.now().getTime();
    if (this.lastFeedbackAt !== null && at - this.lastFeedbackAt < feedbackCooldownMs) {
      return "too_soon";
    }
    this.lastFeedbackAt = at;
    const event = { event: "feedback", properties: { version: this.deps.version, message } };
    const sent = await this.send([event], this.deps.enabled() ? undefined : randomUUID());
    return sent ? "sent" : "failed";
  }

  /** Send the daily events when a day has passed, and `opened` when anything was viewed. */
  async tick(): Promise<void> {
    const at = this.deps.now().getTime();
    if (!this.key || !this.deps.enabled()) {
      this.forget();
      if (this.key) this.deps.watermark.write(at);
      this.wasOff = true;
      return;
    }
    // Back on: nothing from the time it was off is reported, not even the last hour.
    if (this.wasOff) this.deps.watermark.write(at);
    this.wasOff = false;
    if (this.lastDailyAt === null || at - this.lastDailyAt >= day) {
      const facts = this.deps.facts(Math.max(this.deps.watermark.read() ?? 0, at - day));
      this.lastDailyAt = at;
      this.deps.watermark.write(at);
      const clients = [...this.clients];
      const errors = [...this.errors.values()];
      this.clients.clear();
      this.errors.clear();
      const { version } = this.deps;
      await this.send([
        installEvent(version, facts, clients),
        ...providerEvents(version, facts),
        ...occurrenceEvents("connect_result", version, facts.connects),
        ...occurrenceEvents("action_result", version, facts.actions),
        ...countedEvents("delivery_daily", version, facts.deliveries),
        ...countedEvents("server_error", version, errors),
      ]);
    }
    if (this.surfaces.size > 0) {
      const opened = openedEvent(
        this.deps.version,
        [...this.surfaces],
        [...this.views],
        [...this.actions],
      );
      this.actions.clear();
      this.surfaces.clear();
      this.views.clear();
      await this.send([opened]);
    }
  }

  private forget(): void {
    this.surfaces.clear();
    this.views.clear();
    this.actions.clear();
    this.clients.clear();
    this.errors.clear();
  }

  /**
   * One request to PostHog's batch route. Every event is anonymous: no person profile, no GeoIP.
   * Returns false, never throws, when the install ID cannot be read or the request fails.
   */
  private async send(events: readonly Event[], oneOffId?: string): Promise<boolean> {
    let distinctId: string;
    try {
      distinctId = oneOffId ?? this.deps.installId();
    } catch {
      this.deps.log?.("debug", "usage ping not sent: no install ID");
      return false;
    }
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

/** The watermark as a file in the data directory. A missing or unreadable file reads as null. */
export function fileWatermark(dataDir: string): TelemetryOptions["watermark"] {
  const path = join(dataDir, "usage-watermark");
  return {
    read: () => {
      try {
        const value = Number.parseInt(readFileSync(path, "utf8"), 10);
        return Number.isFinite(value) ? value : null;
      } catch {
        return null;
      }
    },
    write: (at) => {
      try {
        writeFileSync(path, `${at}\n`, { mode: 0o600 });
      } catch {
        // An unwritable data directory only risks reporting a period twice.
      }
    },
  };
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
