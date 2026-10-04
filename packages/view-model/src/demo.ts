import type {
  AuthMethod,
  ConnectionState,
  Provider,
  ReconnectReason,
} from "@headroom/core/contracts";
import { providers } from "@headroom/core/contracts";

import type { Metric, OverviewConnection, ResetCredit } from "./overview.ts";

/** A made-up overview for Demo Mode: every provider, plausible figures, no real account data. */
export interface DemoOverview {
  readonly connections: OverviewConnection[];
  readonly providerOrder: Provider[];
}

const minute = 60_000;
const hour = 3_600_000;
const day = 86_400_000;

// ---------- seeded randomness ----------

/** FNV-1a, so a key such as "claude-1:five_hour" always maps to the same number. */
function hashKey(text: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01_00_01_93);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** One independent random stream per key: adding a metric never shifts the figures of another. */
class Stream {
  private readonly next: () => number;

  constructor(seed: number, key: string) {
    this.next = mulberry32((seed ^ hashKey(key)) >>> 0);
    // The first outputs of a generator seeded with close numbers are close; skip them.
    this.next();
    this.next();
  }

  /** A float in [min, max). */
  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** An integer in [min, max], both included. */
  int(min: number, max: number): number {
    return Math.floor(this.between(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new Error("cannot pick from an empty pool");
    return item;
  }

  /** A shuffled copy. */
  shuffle<T>(items: readonly T[]): T[] {
    const pool = [...items];
    const shuffled: T[] = [];
    while (pool.length > 0) shuffled.push(...pool.splice(this.int(0, pool.length - 1), 1));
    return shuffled;
  }
}

function round(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

// ---------- identities ----------

const firstNames = [
  "priya",
  "daniel",
  "marcus",
  "elena",
  "tomas",
  "hannah",
  "kenji",
  "sofia",
  "rowan",
  "nadia",
  "owen",
  "leila",
  "isaac",
  "maya",
  "felix",
  "anika",
  "jonas",
  "camille",
  "dev",
  "ines",
  "callum",
  "tessa",
  "rafael",
  "yuki",
  "noor",
  "gavin",
  "mira",
  "hugo",
  "selin",
  "arjun",
];

const lastNames = [
  "okafor",
  "lindqvist",
  "brandt",
  "castellano",
  "moreau",
  "tanaka",
  "whitfield",
  "varga",
  "haldane",
  "quist",
  "navarro",
  "eriksen",
  "dalton",
  "ferreira",
  "kowalczyk",
  "ashworth",
  "bellamy",
  "chaudhry",
  "donovan",
  "fairbanks",
  "galloway",
  "hartley",
  "iyer",
  "jessup",
  "kessler",
  "lund",
  "mercer",
  "nakamura",
  "oyelaran",
  "pemberton",
];

const otherMailDomains = ["example.org", "example.net", "mail.example", "inbox.example"];
const companyDomains = [
  "halcyonworks.example",
  "brightlane.example",
  "tessellate.example",
  "fernhillstudio.example",
];

type EmailFormat = "dotted" | "joined" | "initial";

/**
 * One owner with a few addresses, the way a real owner signs in everywhere: a main address, a work address,
 * a second personal address and an older one. Names come from fixed pools and every domain is reserved for
 * examples (RFC 2606), so no real person or inbox is named.
 */
interface Owner {
  readonly main: string;
  readonly work: string;
  readonly other: string;
  readonly alt: string;
  /** A GitHub-style handle, for Copilot, which signs in by login and not by email. */
  readonly login: string;
}

function ownerFor(seed: number): Owner {
  const stream = new Stream(seed, "owner");
  const first = stream.pick(firstNames);
  const last = stream.pick(lastNames);
  const formats = stream.shuffle<EmailFormat>(["dotted", "joined", "initial"]);
  const local = (format: EmailFormat): string => {
    if (format === "dotted") return `${first}.${last}`;
    if (format === "joined") return `${first}${last}`;
    return `${first}_${last.charAt(0)}${stream.int(10, 99)}`;
  };
  const main = `${local(formats[0] ?? "dotted")}@example.com`;
  const other = `${local(formats[1] ?? "joined")}@${stream.pick(otherMailDomains)}`;
  const alt = `${local(formats[2] ?? "initial")}@example.com`;
  const work = `${first}.${last}@${stream.pick(companyDomains)}`;
  const login = stream.pick([
    `${first}${last}`,
    `${first.charAt(0)}${last}`,
    `${first}-${last.charAt(0)}${stream.int(10, 99)}`,
  ]);
  return { main, work, other, alt, login };
}

/** The made-up owner's username for this seed, shown in place of the real one while Demo Mode is on. */
export function demoOwnerName(seed: number): string {
  return ownerFor(seed).login;
}

// ---------- builders ----------

interface MetricInput {
  readonly key: string;
  readonly kind: Metric["kind"];
  readonly scope: string;
  readonly unit: string;
  /** The text the connector would store; `valueNum` is derived from it, as the server does. */
  readonly text: string | null;
  readonly unlimited?: boolean;
  readonly windowStart?: number | null;
  readonly windowEnd?: number | null;
  readonly resetsAt?: number | null;
  readonly availability?: Metric["availability"];
  readonly interface?: Metric["interface"];
}

function metricOf(input: MetricInput): Metric {
  return {
    providerMetricKey: input.key,
    kind: input.kind,
    scope: input.scope,
    valueText: input.text,
    valueNum: input.text === null ? null : Number(input.text),
    unit: input.unit,
    unlimited: input.unlimited ?? false,
    windowStart: input.windowStart ?? null,
    windowEnd: input.windowEnd ?? null,
    resetsAt: input.resetsAt ?? null,
    availability: input.availability ?? "available",
    interface: input.interface ?? "private",
  };
}

const money = (value: number): string => value.toFixed(2);

interface Draw {
  readonly seed: number;
  readonly anchor: number;
  readonly id: string;
  /** When the snapshot was read, which some metrics (a rolling spend window) end on. */
  readonly observedAt: number;
}

/** A stream for one metric of one account. */
function streamFor(draw: Draw, key: string): Stream {
  return new Stream(draw.seed, `${draw.id}:${key}`);
}

/** An instant between `min` and `max` ahead of the anchor. */
function ahead(draw: Draw, key: string, min: number, max: number): number {
  return draw.anchor + streamFor(draw, `${key}:reset`).int(min, max);
}

/** The limits are healthy, so none of them is near the default warning threshold of 30% left. */
const healthyMax = 64;

interface Parts {
  readonly plan: string | null;
  readonly metrics: Metric[];
  readonly resetCredits?: ResetCredit[];
}

// ---------- Codex ----------

const sessionWindow = { scope: "window:18000s", min: 10 * minute, max: 4 * hour + 50 * minute };
const weeklyWindow = { scope: "window:604800s", min: hour, max: 6 * day + 20 * hour };

function usedWindow(
  draw: Draw,
  key: string,
  shape: { scope: string; min: number; max: number },
  low: number,
  high: number,
  decimals: number,
): Metric {
  const used = round(streamFor(draw, key).between(low, high), decimals);
  return metricOf({
    key,
    kind: "quota_percentage",
    scope: shape.scope,
    unit: "percent",
    text: String(used),
    resetsAt: ahead(draw, key, shape.min, shape.max),
  });
}

function resetCredit(id: string, expiresAt: number, label: string): ResetCredit {
  return {
    providerCreditId: id,
    eligible: true,
    usable: true,
    expiresAt,
    cooldownUntil: null,
    rawLabel: label,
  };
}

/** Plus has a session window and a weekly window; Pro, as observed, has the weekly window only. */
function codexParts(draw: Draw, shape: "plus" | "pro"): Parts {
  const metrics: Metric[] = [];
  const resetCredits: ResetCredit[] = [];
  if (shape === "plus") {
    metrics.push(
      usedWindow(draw, "rate_limit.primary_window", sessionWindow, 8, 58, 0),
      usedWindow(draw, "rate_limit.secondary_window", weeklyWindow, 10, healthyMax, 0),
    );
  } else {
    metrics.push(usedWindow(draw, "rate_limit.primary_window", weeklyWindow, 12, 52, 0));
  }
  const balance = streamFor(draw, "credits.balance");
  metrics.push(
    metricOf({
      key: "credits.balance",
      kind: "credits",
      scope: "account",
      unit: "codex_credits",
      text: money(shape === "plus" ? balance.between(140, 760) : balance.between(420, 1850)),
    }),
  );
  if (shape === "pro") {
    // One banked reset is about to lapse, which is what the expiry notice is for; the other has weeks left.
    const soon = ahead(draw, "credit-0", Math.round(1.6 * day), Math.round(2.6 * day));
    const later = ahead(draw, "credit-1", 9 * day, 20 * day);
    resetCredits.push(
      resetCredit("credit-0", soon, "Full reset, available"),
      resetCredit("credit-1", later, "Full reset, available"),
    );
  }
  metrics.push(
    metricOf({
      key: "reset_credits.available_count",
      kind: "reset_inventory",
      scope: "account",
      unit: "resets",
      text: String(resetCredits.length),
    }),
  );
  return { plan: shape, metrics, resetCredits };
}

// ---------- Claude ----------

function claudeParts(draw: Draw, shape: "max" | "pro"): Parts {
  const five = usedWindow(draw, "five_hour", sessionWindow, 6, 58, 1);
  // The Pro account carries the one low limit of the dataset; the Max account stays comfortable.
  const weekly =
    shape === "pro"
      ? usedWindow(draw, "seven_day", weeklyWindow, 72, 86, 1)
      : usedWindow(draw, "seven_day", weeklyWindow, 14, 60, 1);
  const metrics: Metric[] = [five, weekly];
  // A model limit is a part of the weekly all-models limit, so it never exceeds it.
  const model = shape === "max" ? "Opus" : "Sonnet";
  const share = streamFor(draw, `limits.${model}`).between(shape === "max" ? 0.3 : 0.4, 0.75);
  metrics.push(
    metricOf({
      key: `limits.${model}`,
      kind: "quota_percentage",
      scope: "window:604800s",
      unit: "percent",
      text: String(round((weekly.valueNum ?? 0) * share, 1)),
      resetsAt: weekly.resetsAt,
    }),
  );
  const resetCredits: ResetCredit[] = [];
  if (shape === "max") {
    // Extra usage is switched on for this account only.
    const cap = streamFor(draw, "extra_usage.monthly_limit").pick([50, 100]);
    const used = streamFor(draw, "extra_usage.used").between(cap * 0.12, cap * 0.6);
    metrics.push(
      metricOf({
        key: "extra_usage.used",
        kind: "spend",
        scope: "month",
        unit: "USD",
        text: money(used),
      }),
      metricOf({
        key: "extra_usage.monthly_limit",
        kind: "spending_cap",
        scope: "month",
        unit: "USD",
        text: money(cap),
      }),
    );
    // An eligible account with one grant that has weeks left. The Pro account is ineligible: no count at all.
    resetCredits.push(resetCredit("grant-0", ahead(draw, "grant-0", 14 * day, 40 * day), "1 left"));
    metrics.push(
      metricOf({
        key: "reset_grants.available",
        kind: "reset_inventory",
        scope: "account",
        unit: "resets",
        text: "1",
      }),
    );
  }
  return { plan: shape, metrics, resetCredits };
}

// ---------- Grok ----------

function grokParts(draw: Draw, shape: "standard" | "heavy"): Parts {
  const end = ahead(draw, "weekly_pool", day, 6 * day + 12 * hour);
  const start = end - 7 * day;
  const pool = round(streamFor(draw, "weekly_pool.used_percent").between(7, 55), 1);
  const week = { windowStart: start, windowEnd: end };
  const metrics: Metric[] = [
    metricOf({
      key: "weekly_pool.used_percent",
      kind: "quota_percentage",
      scope: "window:weekly",
      unit: "percent",
      text: String(pool),
      resetsAt: end,
      ...week,
    }),
  ];
  const product = (name: string, percent: number): Metric =>
    metricOf({
      key: `product.${name}.used_percent`,
      kind: "quota_percentage",
      scope: "window:weekly",
      unit: "percent",
      text: String(percent),
      resetsAt: end,
      ...week,
    });
  if (shape === "standard") {
    // Product shares are parts of the weekly pool, so together they add up to it.
    const code = round(pool * streamFor(draw, "product.grok_code").between(0.45, 0.8), 1);
    metrics.push(product("grok_code", code), product("grok_chat", round(pool - code, 1)));
    const cap = streamFor(draw, "on_demand_cap").pick([100, 200, 500]);
    metrics.push(
      metricOf({
        key: "on_demand_cap",
        kind: "spending_cap",
        scope: "account",
        unit: "grok_credits",
        text: String(cap),
      }),
      metricOf({
        key: "on_demand.used",
        kind: "spend",
        scope: "window:weekly",
        unit: "grok_credits",
        text: String(Math.round(streamFor(draw, "on_demand.used").between(cap * 0.05, cap * 0.5))),
        ...week,
      }),
      metricOf({
        key: "prepaid_balance",
        kind: "credits",
        scope: "account",
        unit: "grok_credits",
        text: String(streamFor(draw, "prepaid_balance").int(120, 2400)),
      }),
    );
  } else {
    // On-demand switched off: the cap reads 0, and the provider omits the spend and balance entirely.
    metrics.push(
      product("grok_chat", pool),
      metricOf({
        key: "on_demand_cap",
        kind: "spending_cap",
        scope: "account",
        unit: "grok_credits",
        text: "0",
      }),
    );
  }
  return { plan: shape === "standard" ? "SuperGrok" : "SuperGrok Heavy", metrics };
}

// ---------- Antigravity ----------

function bucket(
  draw: Draw,
  id: string,
  shape: { scope: string; min: number; max: number },
  low: number,
  high: number,
): Metric {
  const key = `quota.${id}`;
  const used = streamFor(draw, key).between(low, high);
  return metricOf({
    key,
    kind: "quota_percentage",
    scope: shape.scope,
    unit: "percent",
    // The provider reports the remaining fraction; the connector stores used percent with two decimals.
    text: used.toFixed(2),
    resetsAt: ahead(draw, key, shape.min, shape.max),
  });
}

function antigravityParts(draw: Draw, shape: "pro" | "starter"): Parts {
  if (shape === "starter") {
    // The free tier reports the weekly buckets only. Its reset times stay ahead of the demo clock.
    return {
      plan: "Starter Quota",
      metrics: [
        bucket(draw, "gemini-weekly", { ...weeklyWindow, min: day }, 20, 60),
        bucket(draw, "3p-weekly", { ...weeklyWindow, min: day }, 15, 55),
      ],
    };
  }
  return {
    plan: "Google AI Pro",
    metrics: [
      bucket(draw, "gemini-5h", sessionWindow, 3, 55),
      bucket(draw, "gemini-weekly", weeklyWindow, 8, healthyMax),
      bucket(draw, "3p-5h", sessionWindow, 3, 50),
      bucket(draw, "3p-weekly", weeklyWindow, 6, 58),
    ],
  };
}

// ---------- Copilot ----------

/** The first instant of next month in UTC: Copilot gives the reset as a bare date. */
function nextMonthStart(anchor: number): number {
  const at = new Date(anchor);
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1);
}

function copilotParts(draw: Draw): Parts {
  const resetsAt = nextMonthStart(draw.anchor);
  const entitlement = 300;
  const used = streamFor(draw, "credits.used_count").int(24, 180);
  const monthly = (key: string, kind: Metric["kind"], unit: string, text: string | null) =>
    metricOf({
      key,
      kind,
      scope: "month",
      unit,
      text,
      resetsAt,
      unlimited: false,
    });
  return {
    // Every Copilot label ends in "(Copilot)", which is the product and not a plan.
    plan: null,
    metrics: [
      // The percentage and the count describe the same pool.
      monthly(
        "credits.used_percent",
        "quota_percentage",
        "percent",
        String(round((used / entitlement) * 100, 2)),
      ),
      monthly("credits.used_count", "absolute_quota", "credits", String(used)),
      monthly("extra_usage.count", "absolute_quota", "credits", "0"),
      // Chat and completions are unlimited on a paid individual plan: available, no value.
      metricOf({
        key: "chat.used",
        kind: "absolute_quota",
        scope: "month",
        unit: "requests",
        text: null,
        unlimited: true,
        resetsAt,
      }),
      metricOf({
        key: "completions.used",
        kind: "absolute_quota",
        scope: "month",
        unit: "requests",
        text: null,
        unlimited: true,
        resetsAt,
      }),
    ],
  };
}

// ---------- Cursor ----------

/** The same clock time one calendar month before `end`, clamped to the shorter month, in UTC. */
function monthBefore(end: number): number {
  const at = new Date(end);
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const daysBefore = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Date.UTC(
    year,
    month - 1,
    Math.min(at.getUTCDate(), daysBefore),
    at.getUTCHours(),
    at.getUTCMinutes(),
    at.getUTCSeconds(),
    at.getUTCMilliseconds(),
  );
}

function cursorParts(draw: Draw, shape: "pro" | "pro_plus"): Parts {
  const windowEnd = ahead(draw, "cycle", 3 * day, 26 * day);
  const windowStart = monthBefore(windowEnd);
  const cycle = { windowStart, windowEnd };
  const total = round(streamFor(draw, "included.total_percent").between(10, 58), 2);
  const pool = (key: string, low: number, high: number): Metric => {
    const used = Math.min(healthyMax, round(total * streamFor(draw, key).between(low, high), 2));
    return metricOf({
      key,
      kind: "quota_percentage",
      scope: "billing_cycle",
      unit: "percent",
      text: String(used),
      resetsAt: windowEnd,
      ...cycle,
    });
  };
  const metrics: Metric[] = [
    metricOf({
      key: "included.total_percent",
      kind: "quota_percentage",
      scope: "billing_cycle",
      unit: "percent",
      text: String(total),
      resetsAt: windowEnd,
      ...cycle,
    }),
    pool("included.auto_percent", 0.8, 1.2),
    pool("included.api_percent", 0.2, 1),
    // Grok Bot: its own weekly allowance, apart from the billing-cycle pools.
    usedWindow(draw, "grok_bot.used_percent", weeklyWindow, 12, healthyMax, 0),
    metricOf({
      key: "included.limit",
      kind: "spending_cap",
      scope: "billing_cycle",
      unit: "USD",
      text: money(shape === "pro" ? 20 : 60),
      ...cycle,
    }),
  ];
  if (shape === "pro") {
    // A spend limit is set: spend and limit share a scope, and the spend stays well under it.
    const limit = streamFor(draw, "on_demand.limit").pick([25, 50, 100]);
    metrics.push(
      metricOf({
        key: "on_demand.used",
        kind: "spend",
        scope: "on_demand",
        unit: "USD",
        text: money(streamFor(draw, "on_demand.used").between(1.2, limit * 0.45)),
        ...cycle,
      }),
      metricOf({
        key: "on_demand.limit",
        kind: "spending_cap",
        scope: "on_demand",
        unit: "USD",
        text: money(limit),
      }),
    );
  } else {
    // No spend limit set: the provider reports the spend and omits the cap.
    metrics.push(
      metricOf({
        key: "on_demand.used",
        kind: "spend",
        scope: "on_demand",
        unit: "USD",
        text: "0.00",
        ...cycle,
      }),
    );
  }
  // Cursor's label is the email alone, so no plan reaches the overview.
  return { plan: null, metrics };
}

// ---------- Vercel AI Gateway ----------

function vercelParts(draw: Draw, shape: "pro" | "free"): Parts {
  const total = streamFor(draw, "credits.total").pick(shape === "pro" ? [100, 250] : [50, 100]);
  // At least 38% of everything granted stays, so the balance is never near the 30% warning.
  const balance = round(total * streamFor(draw, "credits.balance").between(0.4, 0.85), 2);
  const spent = round(total - balance, 2);
  const credits = (key: string, value: number) =>
    metricOf({
      key,
      kind: "credits",
      scope: "team",
      unit: "gateway_credits",
      text: money(value),
      interface: "official",
    });
  const windowEnd = draw.observedAt;
  const span = { windowStart: windowEnd - 30 * day, windowEnd };
  const spend =
    shape === "pro"
      ? metricOf({
          key: "spend.30d",
          kind: "spend",
          scope: "team",
          unit: "USD",
          text: (spent * streamFor(draw, "spend.30d").between(0.2, 0.55)).toFixed(6),
          interface: "official",
          ...span,
        })
      : // The spend report needs a Pro or Enterprise plan: the row stays, with no value.
        metricOf({
          key: "spend.30d",
          kind: "spend",
          scope: "team",
          unit: "USD",
          text: null,
          availability: "not_authorized",
          interface: "official",
          ...span,
        });
  return {
    // The label is the constant "Vercel AI Gateway": no identity and no plan.
    plan: null,
    metrics: [credits("credits.balance", balance), credits("credits.total_used", spent), spend],
  };
}

// ---------- accounts ----------

interface Account {
  readonly provider: Provider;
  readonly n: number;
  readonly name: string | null;
  readonly identity: (owner: Owner) => string | null;
  readonly authMethod: AuthMethod;
  readonly interface: OverviewConnection["interface"];
  readonly parts: (draw: Draw) => Parts;
  readonly state?: ConnectionState;
  readonly reconnectReason?: ReconnectReason;
  readonly supported?: OverviewConnection["actions"]["supported"];
}

/**
 * The accounts, by provider in the default order. The structure is fixed; the seed changes identities and every
 * figure. Three things are meant to be noticed: the Claude Pro weekly limit running low, a Codex Pro reset credit
 * about to expire, and the Antigravity free account that needs a new sign-in.
 */
const accounts: readonly Account[] = [
  {
    provider: "codex",
    n: 1,
    name: null,
    identity: (owner) => owner.main,
    authMethod: "cli_login",
    interface: "private",
    parts: (draw) => codexParts(draw, "plus"),
    supported: ["consume_reset_credit"],
  },
  {
    provider: "codex",
    n: 2,
    name: "Work",
    identity: (owner) => owner.work,
    authMethod: "cli_login",
    interface: "private",
    parts: (draw) => codexParts(draw, "pro"),
    supported: ["consume_reset_credit"],
  },
  {
    provider: "claude",
    n: 1,
    name: null,
    identity: (owner) => owner.main,
    authMethod: "cli_login",
    interface: "private",
    parts: (draw) => claudeParts(draw, "max"),
  },
  {
    provider: "claude",
    n: 2,
    name: "Side project",
    identity: (owner) => owner.other,
    authMethod: "cli_login",
    interface: "private",
    parts: (draw) => claudeParts(draw, "pro"),
  },
  {
    provider: "grok",
    n: 1,
    name: null,
    identity: (owner) => owner.main,
    authMethod: "cli_login",
    interface: "private",
    parts: (draw) => grokParts(draw, "standard"),
  },
  {
    provider: "grok",
    n: 2,
    name: null,
    identity: (owner) => owner.other,
    authMethod: "cli_login",
    interface: "private",
    parts: (draw) => grokParts(draw, "heavy"),
  },
  {
    provider: "antigravity",
    n: 1,
    name: null,
    identity: (owner) => owner.main,
    authMethod: "paste_redirect",
    interface: "private",
    parts: (draw) => antigravityParts(draw, "pro"),
  },
  {
    provider: "antigravity",
    n: 2,
    name: null,
    identity: (owner) => owner.alt,
    authMethod: "paste_redirect",
    interface: "private",
    parts: (draw) => antigravityParts(draw, "starter"),
    state: "reconnect_required",
    reconnectReason: "refresh_rejected",
  },
  {
    provider: "copilot",
    n: 1,
    name: null,
    identity: (owner) => owner.login,
    authMethod: "device_code",
    interface: "private",
    parts: (draw) => copilotParts(draw),
  },
  {
    provider: "cursor",
    n: 1,
    name: null,
    identity: (owner) => owner.main,
    authMethod: "approval_poll",
    interface: "private",
    parts: (draw) => cursorParts(draw, "pro"),
  },
  {
    provider: "cursor",
    n: 2,
    name: null,
    identity: (owner) => owner.work,
    authMethod: "approval_poll",
    interface: "private",
    parts: (draw) => cursorParts(draw, "pro_plus"),
  },
  {
    provider: "vercel_ai_gateway",
    n: 1,
    name: "Team",
    identity: () => null,
    authMethod: "api_key",
    interface: "official",
    parts: (draw) => vercelParts(draw, "pro"),
  },
  {
    provider: "vercel_ai_gateway",
    n: 2,
    name: "Side project",
    identity: () => null,
    authMethod: "api_key",
    interface: "official",
    parts: (draw) => vercelParts(draw, "free"),
    // The spend report is out of reach on this plan, which the connector reports as a partial reading.
    state: "partial",
  },
];

function connectionOf(
  account: Account,
  owner: Owner,
  seed: number,
  anchor: number,
): OverviewConnection {
  const id = `demo-${account.provider.replaceAll("_", "-")}-${account.n}`;
  const timing = new Stream(seed, `${id}:timing`);
  const state = account.state ?? "ready";
  const needsSignIn = state === "reconnect_required";
  // A refresh finishes within a second or two of the reading it produced.
  const readAgo = needsSignIn ? timing.int(8 * hour, 30 * hour) : timing.int(65_000, 12 * minute);
  const observedAt = anchor - readAgo;
  const finishedAt = observedAt + timing.int(300, 1200);
  const startedAt = observedAt - timing.int(300, 900);
  const parts = account.parts({ seed, anchor, id, observedAt });
  const createdAt = anchor - timing.int(3, 14) * 7 * day - timing.int(0, day);
  const failedAt = anchor - timing.int(2, 20) * minute;
  return {
    id,
    provider: account.provider,
    scope: "individual",
    state,
    reconnectReason: account.reconnectReason ?? null,
    interface: account.interface,
    authMethod: account.authMethod,
    name: account.name,
    identity: account.identity(owner),
    plan: parts.plan,
    createdAt,
    lastSuccessAt: finishedAt,
    stale: needsSignIn,
    latestRun: needsSignIn
      ? {
          startedAt: failedAt,
          finishedAt: failedAt + timing.int(300, 1200),
          outcome: "authentication_failed",
          error: "refresh rejected: 400",
          failureStreak: 3,
        }
      : {
          startedAt,
          finishedAt,
          outcome: state === "partial" ? "partial" : "succeeded",
          error: null,
          failureStreak: 0,
        },
    snapshot: { observedAt, metrics: parts.metrics, resetCredits: parts.resetCredits ?? [] },
    // Mirrors what the provider supports. Switched off, as it is until the owner allows account actions.
    actions: { enabled: false, supported: account.supported ?? [] },
  };
}

/**
 * The same `seed` and `anchor` always give the same overview. `anchor` is the time Demo Mode turned on, so reset
 * times and refresh times stay fixed while the page re-renders.
 */
export function demoOverview(seed: number, anchor: number): DemoOverview {
  const owner = ownerFor(seed);
  return {
    connections: accounts.map((account) => connectionOf(account, owner, seed, anchor)),
    providerOrder: [...providers],
  };
}
