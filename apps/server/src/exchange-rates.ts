import { z } from "zod";

import { currencies } from "@headroom/core/contracts";

import type { Fetch } from "./notify/http.ts";
import { version } from "./version.ts";

const day = 24 * 60 * 60_000;
const defaultTimeoutMs = 10_000;
const defaultCooldownMs = 60_000;

/** Frankfurter serves the European Central Bank's daily reference rates. No key, no account. */
const symbols = currencies.filter((currency) => currency !== "USD");
const endpoint = `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${symbols.join(",")}`;

/** What the routes return and the web reads. Units of each currency per 1 USD; null until a fetch works. */
export interface ExchangeRatesView {
  readonly base: "USD";
  /** The ECB reference date, `YYYY-MM-DD`. */
  readonly date: string | null;
  /** When the last good fetch finished, epoch milliseconds. */
  readonly fetchedAt: number | null;
  readonly perUsd: Readonly<Record<string, number>> | null;
  /** The last fetch failed. Older rates, when there are any, are still served. */
  readonly error: string | null;
}

const responseSchema = z.object({
  base: z.literal("USD"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rates: z.record(z.string(), z.number().positive().finite()),
});

export interface ExchangeRateOptions {
  readonly fetch: Fetch;
  readonly now: () => Date;
  readonly log?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
  /** How long rates stay fresh. Default 24 hours. */
  readonly maxAgeMs?: number;
  readonly timeoutMs?: number;
  /** The least time between two fetches that reads ask for. Default 60 seconds. */
  readonly cooldownMs?: number;
}

type Parsed = { readonly date: string; readonly perUsd: Record<string, number> };

/**
 * The exchange rates for the Wallet, fetched here so the browser never calls the outside service. The last good
 * result stays in memory; a failed fetch keeps it and records the error. Rates older than 24 hours are fetched
 * again on read, and `start` also fetches on a 24 hour timer.
 */
export class ExchangeRateService {
  private good: {
    readonly date: string;
    readonly perUsd: Record<string, number>;
    readonly at: number;
  } | null = null;
  private error: string | null = null;
  private lastAttemptAt: number | null = null;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly maxAgeMs: number;
  private readonly timeoutMs: number;
  private readonly cooldownMs: number;

  constructor(private readonly deps: ExchangeRateOptions) {
    this.maxAgeMs = deps.maxAgeMs ?? day;
    this.timeoutMs = deps.timeoutMs ?? defaultTimeoutMs;
    this.cooldownMs = deps.cooldownMs ?? defaultCooldownMs;
  }

  /** Fetch now, then every 24 hours until `stop`. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.fetchNow(), this.maxAgeMs);
    void this.fetchNow();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  view(): ExchangeRatesView {
    return {
      base: "USD",
      date: this.good?.date ?? null,
      fetchedAt: this.good?.at ?? null,
      perUsd: this.good ? { USD: 1, ...this.good.perUsd } : null,
      error: this.error,
    };
  }

  /** The current rates. Fetches first when there are none or they are older than 24 hours. */
  async get(): Promise<ExchangeRatesView> {
    const at = this.now();
    const stale = this.good === null || at - this.good.at >= this.maxAgeMs;
    if (stale && (this.inFlight !== null || this.cooledDown(at))) await this.fetchNow();
    return this.view();
  }

  private now(): number {
    return this.deps.now().getTime();
  }

  private cooledDown(at: number): boolean {
    return this.lastAttemptAt === null || at - this.lastAttemptAt >= this.cooldownMs;
  }

  /** One fetch at a time: callers that arrive while one runs wait for it. */
  private fetchNow(): Promise<void> {
    this.inFlight ??= this.attempt().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async attempt(): Promise<void> {
    this.lastAttemptAt = this.now();
    const result = await this.load();
    if (typeof result === "string") {
      this.error = result;
      this.deps.log?.("warn", `exchange rates: ${result}`);
      return;
    }
    this.good = { ...result, at: this.now() };
    this.error = null;
    this.deps.log?.("debug", `exchange rates for ${result.date}`);
  }

  /** The parsed rates, or a plain sentence saying why not. Never throws, and never echoes response text. */
  private async load(): Promise<Parsed | string> {
    let response: Response;
    try {
      response = await this.deps.fetch(endpoint, {
        method: "GET",
        headers: { accept: "application/json", "user-agent": `Headroom/${version}` },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      return timedOut
        ? "The rate service did not answer in time."
        : "The rate service could not be reached.";
    }
    if (!response.ok) return `The rate service answered with status ${response.status}.`;
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) return "The rate service sent an unexpected response.";
    const perUsd: Record<string, number> = {};
    for (const currency of symbols) {
      const rate = parsed.data.rates[currency];
      if (rate === undefined) return `The rate service sent no rate for ${currency}.`;
      perUsd[currency] = rate;
    }
    return { date: parsed.data.date, perUsd };
  }
}
