import type { Metric, OverviewConnection, ResetCredit } from "../api.ts";
import { shortDate } from "./time.ts";

/**
 * Turns one overview connection into the panel the dashboard draws. An unavailable metric is
 * unknown (value null), never zero. A metric the provider says it does not support, or that this
 * account may not read, is left out. Money, credits, percentages and reset counts stay separate.
 */

type AmountUnit = "credits" | "usd" | "count" | "requests";

export type Cell =
  | {
      readonly kind: "meter";
      readonly key: string;
      readonly label: string;
      readonly window: string | null;
      /** Name for sentences such as "Claude Weekly Limit Is Running Low". */
      readonly short: string;
      readonly used: number | null;
      readonly unlimited: boolean;
      readonly resetsAt: number | null;
      /** How the caption words the reset: "Resets in", "Cycle ends in", or "Resets with the cycle" with no time. */
      readonly resetWords: "resets" | "cycle_end" | "with_cycle";
      readonly decimals: number;
    }
  | {
      readonly kind: "amount";
      readonly key: string;
      readonly label: string;
      readonly window: string | null;
      readonly value: number | null;
      readonly unlimited: boolean;
      readonly unit: AmountUnit;
      readonly decimals: number;
      /** A total the value is part of, already formatted, for example "5.00". */
      readonly of: string | null;
      readonly note: string | null;
    }
  | {
      readonly kind: "resets";
      readonly key: string;
      readonly label: string;
      readonly window: string;
      /** Null when the provider reported the count as unknown. */
      readonly count: number | null;
      /** Expiry instants of usable resets, soonest first. */
      readonly expiries: readonly number[];
    };

type MeterCell = Extract<Cell, { kind: "meter" }>;

interface Fact {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface PanelModel {
  readonly cells: readonly Cell[];
  readonly facts: readonly Fact[];
  /** The reset credit the hold-to-confirm button would use: the soonest to expire. */
  readonly hold: { readonly creditId: string; readonly expiresAt: number | null } | null;
  /** Banked resets shown as a compact summary instead of a cell, or null when the account has none to report. */
  readonly banked: {
    readonly count: number;
    readonly label: string;
    /** Expiry instants of usable resets, soonest first. */
    readonly expiries: readonly number[];
  } | null;
  /** The meter that best summarises the account, for the accounts table. */
  readonly tightest: {
    readonly label: string;
    readonly used: number;
    readonly resetsAt: number | null;
  } | null;
  /** For accounts with no meters: the credit balance. */
  readonly balance: {
    readonly label: string;
    readonly value: number;
    readonly unit: string;
  } | null;
}

// ---------- formatting ----------

export function formatNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatUsd(value: number): string {
  return `$${formatNumber(value, 2)}`;
}

function amountText(value: number, singular: string): string {
  const decimals = Number.isInteger(value) ? 0 : 2;
  return `${formatNumber(value, decimals)} ${value === 1 ? singular : `${singular}s`}`;
}

function titleCase(text: string): string {
  return text
    .split(/[\s_-]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---------- metric access ----------

function numberOf(metric: Metric): number | null {
  return metric.availability === "available" ? metric.valueNum : null;
}

/** Rows the provider cannot or may not report are not shown at all. */
function shown(metric: Metric): boolean {
  return metric.availability !== "unsupported" && metric.availability !== "not_authorized";
}

function windowSeconds(scope: string): number | null {
  const match = /^window:(\d+)s$/.exec(scope);
  return match?.[1] === undefined ? null : Number(match[1]);
}

interface Span {
  readonly label: string;
  readonly window: string | null;
  readonly seconds: number | null;
}

function spanOf(scope: string): Span {
  const seconds = scope === "window:weekly" ? 604_800 : windowSeconds(scope);
  if (seconds === 18_000) return { label: "Session", window: "5 hours", seconds };
  if (seconds === 604_800) return { label: "Weekly", window: "7 days", seconds };
  if (seconds === 86_400) return { label: "Daily", window: "24 hours", seconds };
  if (seconds !== null) {
    const hours = seconds / 3600;
    const window = hours < 48 ? `${Math.round(hours)} hours` : `${Math.round(hours / 24)} days`;
    return { label: "Limit", window, seconds };
  }
  return { label: "Limit", window: null, seconds: null };
}

function decimalsFor(used: number | null, provider: OverviewConnection["provider"]): number {
  if (provider === "copilot") return 1;
  return used !== null && used > 0 && used < 1 ? 1 : 0;
}

// ---------- builders ----------

interface Context {
  readonly connection: OverviewConnection;
  readonly metrics: ReadonlyMap<string, Metric>;
  /** Keys a provider rule already turned into a cell or fact. */
  readonly used: Set<string>;
}

function take(context: Context, key: string): Metric | null {
  const metric = context.metrics.get(key);
  if (metric === undefined) return null;
  context.used.add(key);
  return shown(metric) ? metric : null;
}

interface MeterOptions {
  readonly label: string;
  readonly window: string | null;
  readonly short?: string;
  readonly resetWords?: MeterCell["resetWords"];
}

function meterOf(context: Context, metric: Metric, options: MeterOptions): MeterCell {
  context.used.add(metric.providerMetricKey);
  const unlimited = metric.unlimited === true;
  const used = unlimited ? null : numberOf(metric);
  return {
    kind: "meter",
    key: metric.providerMetricKey,
    label: options.label,
    window: options.window,
    short: options.short ?? options.label,
    used,
    unlimited,
    resetsAt: metric.resetsAt,
    resetWords: options.resetWords ?? "resets",
    decimals: decimalsFor(used, context.connection.provider),
  };
}

function meterFor(context: Context, key: string, options: MeterOptions): MeterCell[] {
  const metric = take(context, key);
  return metric === null ? [] : [meterOf(context, metric, options)];
}

function amountOf(
  metric: Metric,
  options: {
    label: string;
    window: string | null;
    unit: AmountUnit;
    decimals?: number;
    of?: string | null;
    note?: string | null;
  },
): Cell {
  const value = metric.unlimited === true ? null : numberOf(metric);
  return {
    kind: "amount",
    key: metric.providerMetricKey,
    label: options.label,
    window: options.window,
    value,
    unlimited: metric.unlimited === true,
    unit: options.unit,
    decimals: options.decimals ?? (value !== null && Number.isInteger(value) ? 0 : 2),
    of: options.of ?? null,
    note: options.note ?? null,
  };
}

function factOf(key: string, label: string, text: string): Fact {
  return { key, label, value: text };
}

/** A fact for a metric, "Unknown" when the provider did not report a value. */
function factFor(
  context: Context,
  key: string,
  label: string,
  format: (value: number, metric: Metric) => string,
  factKey = key,
): Fact[] {
  const metric = take(context, key);
  if (metric === null) return [];
  if (metric.unlimited === true) return [factOf(factKey, label, "Unlimited")];
  const value = numberOf(metric);
  return [factOf(factKey, label, value === null ? "Unknown" : format(value, metric))];
}

function prettifyKey(key: string): string {
  return titleCase(key.replace(/^grok_/, ""));
}

function byKey(a: { key: string }, b: { key: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function keysWith(context: Context, prefix: string, suffix: string): string[] {
  return [...context.metrics.keys()]
    .filter((key) => key.startsWith(prefix) && key.endsWith(suffix))
    .toSorted();
}

interface Built {
  meters: MeterCell[];
  others: Cell[];
  facts: Fact[];
  banked?: PanelModel["banked"];
}

function claude(context: Context): Built {
  const meters: MeterCell[] = [
    ...meterFor(context, "five_hour", { label: "Session", window: "5 hours" }),
    ...meterFor(context, "seven_day", {
      label: "Weekly",
      window: "all models",
      short: "Weekly",
    }),
  ];
  const scoped = keysWith(context, "limits.", "").map((key) => ({
    key,
    name: key.slice("limits.".length),
  }));
  const scopedNames = new Set(scoped.map((entry) => entry.name.toLowerCase()));
  const models = [...scoped];
  // The older Sonnet bucket duplicates a scoped limit of the same name, so the scoped one wins.
  if (scopedNames.has("sonnet")) context.used.add("seven_day_sonnet");
  else models.push({ key: "seven_day_sonnet", name: "Sonnet" });
  for (const { key, name } of models.toSorted((a, b) => a.name.localeCompare(b.name))) {
    meters.push(
      ...meterFor(context, key, { label: "Weekly", window: name, short: `Weekly ${name}` }),
    );
  }
  const spend = take(context, "extra_usage.used");
  const cap = take(context, "extra_usage.monthly_limit");
  const facts: Fact[] = [];
  const grants = take(context, "reset_grants.available");
  const stored = context.connection.snapshot?.resetCredits ?? [];
  // Display only: no hold, because the Claude connector supports no account action.
  const grantCount = grants === null ? stored.filter((c) => c.usable).length : numberOf(grants);
  // An unreported count is unknown, not zero, so it shows nothing.
  const banked: PanelModel["banked"] =
    (grants === null && stored.length === 0) || grantCount === null
      ? null
      : {
          count: grantCount,
          label: "Reset Grant",
          expiries: stored
            .filter((grant) => grant.usable && grant.expiresAt !== null)
            .map((grant) => grant.expiresAt ?? 0)
            .toSorted((a, b) => a - b),
        };
  if (spend !== null) {
    const used = numberOf(spend);
    const limit = cap === null ? null : numberOf(cap);
    facts.push(
      factOf(
        "extra_usage.used",
        "Extra Usage Spend",
        used === null
          ? "Unknown"
          : limit === null
            ? formatUsd(used)
            : `${formatUsd(used)} of ${formatUsd(limit)}`,
      ),
    );
  }
  return { meters, others: [], facts, banked };
}

function codex(context: Context): Built {
  const meters: { cell: MeterCell; core: boolean; seconds: number | null }[] = [];
  for (const key of context.metrics.keys()) {
    const core = /^rate_limit\.(primary|secondary)_window$/.test(key);
    const extra = /^additional\.(.+)\.(primary|secondary)_window$/.exec(key);
    if (!core && extra === null) continue;
    const metric = take(context, key);
    if (metric === null) continue;
    const span = spanOf(metric.scope);
    const name = extra?.[1];
    const window =
      name === undefined
        ? span.window
        : span.label === "Session"
          ? `${name} · ${span.window}`
          : name;
    const short = name === undefined ? span.label : `${name} ${span.label}`;
    meters.push({
      cell: meterOf(context, metric, { label: span.label, window, short }),
      core,
      seconds: span.seconds,
    });
  }
  meters.sort(
    (a, b) =>
      Number(b.core) - Number(a.core) ||
      (a.seconds ?? Infinity) - (b.seconds ?? Infinity) ||
      byKey(a.cell, b.cell),
  );
  const others: Cell[] = [];
  const credits = take(context, "credits.balance");
  if (credits !== null) {
    others.push(
      amountOf(credits, {
        label: "Credits",
        window: "balance",
        unit: "credits",
        // The usage response carries no expiry for credits, so say nothing rather than imply none.
        note: null,
      }),
    );
  }
  const count = take(context, "reset_credits.available_count");
  const banked = context.connection.snapshot?.resetCredits ?? [];
  if (count !== null || banked.length > 0) {
    const reported = count === null ? banked.filter((c) => c.usable).length : numberOf(count);
    others.push({
      kind: "resets",
      key: "reset_credits.available_count",
      label: "Reset Credits",
      window: "banked",
      count: reported,
      expiries: banked
        .filter((credit) => credit.usable && credit.expiresAt !== null)
        .map((credit) => credit.expiresAt ?? 0)
        .toSorted((a, b) => a - b),
    });
  }
  return { meters: meters.map((entry) => entry.cell), others, facts: [] };
}

function cursor(context: Context): Built {
  const limit = take(context, "included.limit");
  const cap = limit === null ? null : numberOf(limit);
  const planWindow = cap === null ? "billing cycle" : `${formatUsd(cap).replace(/\.00$/, "")} plan`;
  const meters = [
    ...meterFor(context, "included.total_percent", {
      label: "Included",
      window: planWindow,
      short: "Included Usage",
      resetWords: "cycle_end",
    }),
    ...meterFor(context, "included.auto_percent", {
      label: "Auto Pool",
      window: "billing cycle",
      resetWords: "with_cycle",
    }),
    ...meterFor(context, "included.api_percent", {
      label: "API Pool",
      window: "billing cycle",
      resetWords: "with_cycle",
    }),
  ];
  const facts: Fact[] = [];
  const spend = take(context, "on_demand.used");
  const onDemandLimit = take(context, "on_demand.limit");
  if (spend !== null) {
    const used = numberOf(spend);
    const max = onDemandLimit === null ? null : numberOf(onDemandLimit);
    facts.push(
      factOf(
        "on_demand.used",
        "On-Demand Spend",
        used === null
          ? "Unknown"
          : max === null
            ? formatUsd(used)
            : `${formatUsd(used)} of ${formatUsd(max)}`,
      ),
    );
  }
  const cycle = context.metrics.get("included.total_percent");
  if (cycle?.windowStart !== null && cycle?.windowStart !== undefined && cycle.windowEnd !== null) {
    facts.push(
      factOf("cycle", "Cycle", `${shortDate(cycle.windowStart)} to ${shortDate(cycle.windowEnd)}`),
    );
  }
  return { meters, others: [], facts };
}

function grok(context: Context): Built {
  const meters = meterFor(context, "weekly_pool.used_percent", {
    label: "Weekly Pool",
    window: "7 days",
  });
  for (const key of keysWith(context, "product.", ".used_percent")) {
    const product = key.slice("product.".length, -".used_percent".length);
    meters.push(
      ...meterFor(context, key, {
        label: prettifyKey(product),
        window: "share of pool",
        short: `${prettifyKey(product)} Share`,
      }),
    );
  }
  const facts: Fact[] = [];
  const cap = take(context, "on_demand_cap");
  const used = take(context, "on_demand.used");
  const capValue = cap === null ? null : numberOf(cap);
  const usedValue = used === null ? null : numberOf(used);
  if (cap !== null) {
    facts.push(
      factOf(
        "on_demand_cap",
        "On-Demand",
        capValue === null
          ? "Unknown"
          : capValue === 0
            ? "Off"
            : usedValue === null
              ? `Up to ${amountText(capValue, "credit")}`
              : `${formatNumber(usedValue, 0)} of ${amountText(capValue, "credit")}`,
      ),
    );
  } else if (used !== null) {
    facts.push(
      factOf(
        "on_demand.used",
        "On-Demand Used",
        usedValue === null ? "Unknown" : amountText(usedValue, "credit"),
      ),
    );
  }
  facts.push(
    ...factFor(context, "prepaid_balance", "Prepaid Balance", (n) => amountText(n, "credit")),
  );
  return { meters, others: [], facts };
}

function antigravity(context: Context): Built {
  const groups: [string, string][] = [
    ["gemini", "Gemini"],
    ["3p", "Claude and GPT"],
  ];
  const meters: MeterCell[] = [];
  const spans: [string, string][] = [
    ["5h", "5 hours"],
    ["weekly", "weekly"],
  ];
  for (const [id, label] of groups) {
    for (const [suffix, window] of spans) {
      meters.push(
        ...meterFor(context, `quota.${id}-${suffix}`, {
          label,
          window,
          short: `${label} ${window === "weekly" ? "Weekly" : "5-Hour"}`,
        }),
      );
    }
  }
  return { meters, others: [], facts: [] };
}

const asRequests = (n: number): string => amountText(n, "request");

function copilot(context: Context): Built {
  const meters = meterFor(context, "credits.used_percent", {
    label: "AI Credits",
    window: "monthly",
  });
  const facts = [
    ...factFor(context, "credits.used_count", "Credits Used", (n) => formatNumber(n, 0)),
    ...factFor(context, "extra_usage.count", "Extra Usage", (n) => amountText(n, "credit")),
    ...factFor(context, "chat.used", "Chat", asRequests),
    ...factFor(context, "completions.used", "Completions", asRequests),
  ];
  return { meters, others: [], facts };
}

function vercel(context: Context): Built {
  const others: Cell[] = [];
  const balance = take(context, "credits.balance");
  const total = take(context, "credits.total_used");
  const left = balance === null ? null : numberOf(balance);
  const spent = total === null ? null : numberOf(total);
  if (balance !== null) {
    const sum = left !== null && spent !== null ? formatNumber(left + spent, 2) : null;
    others.push(
      amountOf(balance, {
        label: "Credit Balance",
        window: null,
        unit: "credits",
        decimals: 2,
        of: sum,
        note: sum !== null && spent !== null ? `${formatNumber(spent, 2)} used of ${sum}` : null,
      }),
    );
  }
  if (total !== null) {
    others.push(
      amountOf(total, {
        label: "Credits Used",
        window: "lifetime",
        unit: "credits",
        decimals: 2,
        note: "On this gateway key",
      }),
    );
  }
  for (const key of keysWith(context, "spend.", "d")) {
    const metric = take(context, key);
    const days = /^spend\.(\d+)d$/.exec(key)?.[1];
    if (metric === null || days === undefined) continue;
    others.push(
      amountOf(metric, { label: "Spend", window: `${days} days`, unit: "usd", decimals: 2 }),
    );
  }
  return { meters: [], others, facts: [] };
}

/** Keys no provider rule claimed still show: percentages as meters, the rest as facts. */
function leftovers(context: Context): Built {
  const meters: MeterCell[] = [];
  const facts: Fact[] = [];
  for (const key of [...context.metrics.keys()].toSorted()) {
    if (context.used.has(key)) continue;
    const metric = take(context, key);
    if (metric === null) continue;
    const label = titleCase(key.replaceAll(".", " "));
    if (metric.kind === "quota_percentage") {
      meters.push(meterOf(context, metric, { label, window: spanOf(metric.scope).window }));
    } else {
      const text =
        metric.unit === "USD"
          ? formatUsd
          : (n: number) => formatNumber(n, Number.isInteger(n) ? 0 : 2);
      facts.push(...factFor(context, key, label, text));
    }
  }
  return { meters, others: [], facts };
}

const builders: Record<OverviewConnection["provider"], (context: Context) => Built> = {
  claude,
  codex,
  cursor,
  grok,
  antigravity,
  copilot,
  vercel_ai_gateway: vercel,
};

/** The meter that stands for the account. These are the totals; other meters are parts of them. */
const primaryKeys: Partial<Record<OverviewConnection["provider"], string>> = {
  claude: "seven_day",
  cursor: "included.total_percent",
  grok: "weekly_pool.used_percent",
};

function holdOf(
  connection: OverviewConnection,
  credits: readonly ResetCredit[],
  now: number | undefined,
): PanelModel["hold"] {
  if (!connection.actions.supported.includes("consume_reset_credit")) return null;
  // The soonest-expiring credit that is still live, so the hold always spends the one about to lapse.
  const usable = credits
    .filter((credit) => credit.usable && credit.eligible)
    .filter((credit) => now === undefined || credit.expiresAt === null || credit.expiresAt > now)
    .toSorted(
      (a, b) =>
        (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) ||
        a.providerCreditId.localeCompare(b.providerCreditId),
    );
  const first = usable[0];
  return first === undefined
    ? null
    : { creditId: first.providerCreditId, expiresAt: first.expiresAt };
}

function tightestOf(
  provider: OverviewConnection["provider"],
  meters: readonly MeterCell[],
): PanelModel["tightest"] {
  const candidates = meters.filter((cell) => cell.used !== null && !cell.unlimited);
  const primary = candidates.find((cell) => cell.key === primaryKeys[provider]);
  let best = primary;
  if (best === undefined) {
    for (const cell of candidates) {
      if (best === undefined || (cell.used ?? 0) > (best.used ?? 0)) best = cell;
    }
  }
  if (best === undefined || best.used === null) return null;
  return { label: best.short, used: best.used, resetsAt: best.resetsAt };
}

/** `now` drops reset credits that have already expired from the hold target. */
export function presentPanel(connection: OverviewConnection, now?: number): PanelModel {
  const snapshot = connection.snapshot;
  const context: Context = {
    connection,
    metrics: new Map((snapshot?.metrics ?? []).map((metric) => [metric.providerMetricKey, metric])),
    used: new Set(),
  };
  const built = builders[connection.provider](context);
  const rest = leftovers(context);
  const meters = [...built.meters, ...rest.meters];
  const cells: Cell[] = [...meters, ...built.others];
  const facts = [...built.facts, ...rest.facts];
  const balanceCell = cells.find(
    (cell) => cell.kind === "amount" && cell.key === "credits.balance",
  );
  return {
    cells,
    facts,
    banked: built.banked ?? null,
    hold: holdOf(connection, snapshot?.resetCredits ?? [], now),
    tightest: tightestOf(connection.provider, meters),
    balance:
      meters.length === 0 &&
      balanceCell?.kind === "amount" &&
      balanceCell.value !== null &&
      !balanceCell.unlimited
        ? { label: balanceCell.label, value: balanceCell.value, unit: balanceCell.unit }
        : null,
  };
}
