import type { OverviewConnection } from "./overview.ts";
import { suggestPrices, type Cost, type Money, type TopUp, type WalletBook } from "./wallet.ts";

/** A made-up Wallet for Demo Mode, shaped to show every kind of entry. Same `seed` and `anchor`, same book. */

const day = 86_400_000;

// ---------- seeded randomness (small copies of the helpers in demo.ts) ----------

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

/** An integer in [min, max], both included, from its own stream per key. */
function intFor(seed: number, key: string, min: number, max: number): number {
  const next = mulberry32((seed ^ hashKey(key)) >>> 0);
  // The first outputs of generators seeded with close numbers are close; skip them.
  next();
  next();
  return Math.floor(min + next() * (max - min + 1));
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------- the book ----------

const usd = (dollars: number): Money => ({ minor: dollars * 100, currency: "USD" });

/** A list price that fits the account's plan; the first suggestion, or `fallback` when none fits. */
function listPrice(
  connection: OverviewConnection,
  label: string | null,
  fallback: Money,
): { price: Money; cycle: "monthly" | "annual" } {
  const options = suggestPrices(connection.provider, connection.plan);
  const found =
    (label === null ? undefined : options.find((option) => option.label === label)) ?? options[0];
  return found === undefined
    ? { price: fallback, cycle: "monthly" }
    : { price: found.price, cycle: found.cycle };
}

/**
 * The book for the demo accounts. Accounts are told apart by provider and position, so it fits the overview that
 * `demoOverview` builds; any other account is left Not set.
 */
export function demoWallet(
  seed: number,
  connections: readonly OverviewConnection[],
  anchor: number,
): WalletBook {
  const costs: Record<string, Cost> = {};
  const seen = new Map<string, number>();
  const byPosition = new Map<string, OverviewConnection>();
  for (const connection of connections) {
    const position = (seen.get(connection.provider) ?? 0) + 1;
    seen.set(connection.provider, position);
    byPosition.set(`${connection.provider}:${position}`, connection);
  }

  const renewal = (connection: OverviewConnection): string =>
    isoDate(anchor + intFor(seed, `${connection.id}:renews`, 1, 28) * day);
  const paid = (
    connection: OverviewConnection,
    price: Money,
    cycle: "monthly" | "annual",
  ): Cost => ({ kind: "paid", price, cycle, renewsOn: renewal(connection) });
  const set = (position: string, make: (connection: OverviewConnection) => Cost): void => {
    const connection = byPosition.get(position);
    if (connection !== undefined) costs[connection.id] = make(connection);
  };

  // Claude Max at list price, and a Pro account billed in rupees so the conversion shows.
  set("claude:1", (connection) => {
    const { price, cycle } = listPrice(connection, "Max 5x", usd(100));
    return paid(connection, price, cycle);
  });
  set("claude:2", (connection) => paid(connection, { minor: 199_900, currency: "INR" }, "monthly"));
  set("codex:1", (connection) => {
    const { price, cycle } = listPrice(connection, "Plus", usd(20));
    return paid(connection, price, cycle);
  });
  set("codex:2", (connection) => {
    const { price, cycle } = listPrice(connection, "Pro 200", usd(200));
    return paid(connection, price, cycle);
  });
  set("grok:1", () => ({ kind: "included", includedWith: "X Premium" }));
  set("grok:2", (connection) => {
    const { price, cycle } = listPrice(connection, "SuperGrok Heavy", usd(300));
    return paid(connection, price, cycle);
  });
  set("antigravity:1", () => ({ kind: "included", includedWith: "Google AI Pro" }));
  set("antigravity:2", () => ({ kind: "free" }));
  set("copilot:1", () => ({ kind: "included", includedWith: "GitHub Pro" }));
  // Cursor Pro paid yearly (ten months' price); the Pro+ account is the one left Not set.
  set("cursor:1", (connection) => paid(connection, usd(200), "annual"));
  // Vercel AI Gateway bills by credits, not by subscription.
  set("vercel_ai_gateway:1", () => ({ kind: "free" }));
  set("vercel_ai_gateway:2", () => ({ kind: "free" }));

  const topUpOn = (key: string, connectionKey: string, over: Partial<TopUp>): TopUp[] => {
    const connection = byPosition.get(connectionKey);
    if (connection === undefined) return [];
    return [
      {
        id: `demo-topup-${key}`,
        connectionId: connection.id,
        date: isoDate(anchor - intFor(seed, `topup:${key}`, 1, 40) * day),
        kind: "paid",
        price: null,
        credits: null,
        note: null,
        ...over,
      },
    ];
  };
  const topUps = [
    // Dated on the anchor day, so "Top-Ups This Month" always has one to show.
    ...topUpOn("codex-credits", "codex:1", {
      date: isoDate(anchor),
      price: usd(intFor(seed, "topup:codex-credits:amount", 1, 3) * 10),
      credits: 250,
      note: "Codex credits",
    }),
    ...topUpOn("gateway-credits", "vercel_ai_gateway:1", {
      price: usd(50),
      note: "Gateway credits",
    }),
    ...topUpOn("promo", "codex:2", { kind: "free", credits: 100, note: "Promo credits" }),
    ...topUpOn("gateway-free", "vercel_ai_gateway:2", {
      kind: "free",
      credits: 5,
      note: "Free monthly credit",
    }),
  ];

  return {
    costs,
    topUps,
    displayCurrency: "USD",
    // Mid-market rates, early October 2026.
    perUsd: { USD: 1, INR: 95.16, EUR: 0.88, GBP: 0.75 },
  };
}
