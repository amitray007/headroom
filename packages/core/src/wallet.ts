import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { type Db, schema } from "./db/index.ts";
import { billingCycleSchema, currencySchema, topUpKindSchema } from "./enums.ts";

/**
 * The Wallet: what the owner pays per linked account, and the credits they top up. A cost with no
 * row is "Not set". It is never stored as zero. Top-ups carry no foreign key so the history
 * outlives a removed account; a cost row is deleted with its connection.
 */

/** A real calendar day as `YYYY-MM-DD`: 2026-02-30 is rejected. */
export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "not a calendar day");

/** An amount in minor units (cents, paise, whole yen) with its currency. */
export const moneySchema = z.object({
  minor: z.number().int().positive().safe(),
  currency: currencySchema,
});
export type WalletMoney = z.infer<typeof moneySchema>;

export const costSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("paid"),
    price: moneySchema,
    cycle: billingCycleSchema,
    renewsOn: calendarDaySchema.nullable(),
  }),
  z.object({ kind: z.literal("free") }),
  z.object({
    kind: z.literal("included"),
    includedWith: z.string().trim().min(1).max(80),
  }),
]);
export type Cost = z.infer<typeof costSchema>;

const topUpFields = z.object({
  connectionId: z.string().min(1),
  date: calendarDaySchema,
  kind: topUpKindSchema,
  price: moneySchema.nullable(),
  credits: z.number().positive().finite().nullable(),
  note: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .transform((note) => (note === null || note === "" ? null : note)),
});

function priceMatchesKind(value: { kind: "paid" | "free"; price: WalletMoney | null }): boolean {
  return value.kind === "paid" ? value.price !== null : value.price === null;
}
const priceMessage = "A paid top-up needs a price; a free one has none.";

export const topUpInputSchema = topUpFields.refine(priceMatchesKind, priceMessage);
export type TopUpInput = z.infer<typeof topUpInputSchema>;

export const topUpSchema = topUpFields
  .extend({ id: z.string().min(1) })
  .refine(priceMatchesKind, priceMessage);
export type TopUp = z.infer<typeof topUpSchema>;

export interface WalletBook {
  costs: Record<string, Cost>;
  topUps: TopUp[];
}

export class UnknownConnectionError extends Error {
  constructor() {
    super("unknown connection");
    this.name = "UnknownConnectionError";
  }
}

type CostRow = typeof schema.walletCosts.$inferSelect;
type TopUpRow = typeof schema.walletTopUps.$inferSelect;

function costFromRow(row: CostRow): Cost | null {
  const candidate =
    row.kind === "paid"
      ? {
          kind: "paid",
          price:
            row.priceMinor !== null && row.priceCurrency !== null
              ? { minor: row.priceMinor, currency: row.priceCurrency }
              : null,
          cycle: row.cycle,
          renewsOn: row.renewsOn,
        }
      : row.kind === "free"
        ? { kind: "free" }
        : { kind: "included", includedWith: row.includedWith };
  const parsed = costSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function topUpFromRow(row: TopUpRow): TopUp | null {
  const parsed = topUpSchema.safeParse({
    id: row.id,
    connectionId: row.connectionId,
    date: row.date,
    kind: row.kind,
    price:
      row.priceMinor !== null && row.priceCurrency !== null
        ? { minor: row.priceMinor, currency: row.priceCurrency }
        : null,
    credits: row.credits,
    note: row.note,
  });
  return parsed.success ? parsed.data : null;
}

export class WalletStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every cost and every top-up, newest top-up first. Rows that no longer parse are skipped. */
  book(): WalletBook {
    const costs: Record<string, Cost> = {};
    for (const row of this.db.select().from(schema.walletCosts).all()) {
      const cost = costFromRow(row);
      if (cost) costs[row.connectionId] = cost;
    }
    const topUps = this.db
      .select()
      .from(schema.walletTopUps)
      .orderBy(
        desc(schema.walletTopUps.date),
        desc(schema.walletTopUps.createdAt),
        desc(sql`rowid`),
      )
      .all()
      .flatMap((row) => topUpFromRow(row) ?? []);
    return { costs, topUps };
  }

  /** Insert or replace one account's cost. The caller validated it with `costSchema`. */
  setCost(connectionId: string, cost: Cost): void {
    this.requireConnection(connectionId);
    const values = {
      kind: cost.kind,
      priceMinor: cost.kind === "paid" ? cost.price.minor : null,
      priceCurrency: cost.kind === "paid" ? cost.price.currency : null,
      cycle: cost.kind === "paid" ? cost.cycle : null,
      renewsOn: cost.kind === "paid" ? cost.renewsOn : null,
      includedWith: cost.kind === "included" ? cost.includedWith : null,
      updatedAt: this.now(),
    };
    this.db
      .insert(schema.walletCosts)
      .values({ connectionId, ...values })
      .onConflictDoUpdate({ target: schema.walletCosts.connectionId, set: values })
      .run();
  }

  /** Back to "Not set". Does nothing when there is no cost. */
  clearCost(connectionId: string): void {
    this.db
      .delete(schema.walletCosts)
      .where(eq(schema.walletCosts.connectionId, connectionId))
      .run();
  }

  addTopUp(input: TopUpInput): TopUp {
    this.requireConnection(input.connectionId);
    const id = crypto.randomUUID();
    this.db
      .insert(schema.walletTopUps)
      .values({
        id,
        connectionId: input.connectionId,
        date: input.date,
        kind: input.kind,
        priceMinor: input.price?.minor ?? null,
        priceCurrency: input.price?.currency ?? null,
        credits: input.credits,
        note: input.note,
        createdAt: this.now(),
      })
      .run();
    return { ...input, id };
  }

  /** Does nothing when the id is unknown. */
  removeTopUp(id: string): void {
    this.db.delete(schema.walletTopUps).where(eq(schema.walletTopUps.id, id)).run();
  }

  private requireConnection(connectionId: string): void {
    const row = this.db
      .select({ id: schema.connections.id })
      .from(schema.connections)
      .where(eq(schema.connections.id, connectionId))
      .get();
    if (!row) throw new UnknownConnectionError();
  }
}
