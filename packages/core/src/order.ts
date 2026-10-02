import { eq } from "drizzle-orm";
import { z } from "zod";

import { type Db, schema } from "./db/index.ts";
import { type Provider, providers, providerSchema } from "./enums.ts";

/**
 * Owner-defined display order: providers as a group, accounts within their own provider.
 * Providers live in the one-row `display_order` table; accounts use `connections.position`.
 * A provider or account the owner never ordered keeps its default place after the ordered ones.
 */

export const orderBodySchema = z.object({
  providers: z.array(providerSchema),
  accounts: z.record(z.string(), z.array(z.string())),
});
export type OrderBody = z.infer<typeof orderBodySchema>;

export interface EffectiveOrder {
  providers: Provider[];
  accounts: Record<string, string[]>;
}

export class InvalidOrderError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "InvalidOrderError";
  }
}

const ownerRow = "owner";

interface Orderable {
  readonly id: string;
  readonly provider: Provider;
  readonly position: number | null;
  readonly createdAt: Date;
}

export class OrderStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Stored provider order first (known providers only), then the rest in default order. */
  providerOrder(): Provider[] {
    const row = this.db
      .select()
      .from(schema.displayOrder)
      .where(eq(schema.displayOrder.id, ownerRow))
      .get();
    let stored: Provider[] = [];
    if (row) {
      try {
        const parsed = z.array(providerSchema).safeParse(JSON.parse(row.providersJson));
        if (parsed.success) stored = parsed.data;
      } catch {
        // Unreadable stored order falls back to the default.
      }
    }
    const seen = new Set(stored);
    return [...stored, ...providers.filter((provider) => !seen.has(provider))].filter(
      (provider, index, all) => all.indexOf(provider) === index,
    );
  }

  /** Sort by effective provider order, then position (null last), then creation time. */
  arrange<T extends Orderable>(rows: readonly T[]): T[] {
    const rank = new Map(this.providerOrder().map((provider, index) => [provider, index]));
    return rows.toSorted(
      (a, b) =>
        (rank.get(a.provider) ?? 0) - (rank.get(b.provider) ?? 0) ||
        (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  /** The full effective order: every provider, and the connection ids of each provider that has any. */
  effective(): EffectiveOrder {
    const accounts: Record<string, string[]> = {};
    for (const row of this.arrange(this.db.select().from(schema.connections).all())) {
      (accounts[row.provider] ??= []).push(row.id);
    }
    return { providers: this.providerOrder(), accounts };
  }

  /**
   * Validate everything first, then write in one transaction. Throws InvalidOrderError and
   * changes nothing when any entry is unknown, duplicated or on the wrong provider.
   */
  apply(input: OrderBody): EffectiveOrder {
    if (new Set(input.providers).size !== input.providers.length) {
      throw new InvalidOrderError("duplicate provider");
    }
    const rows = this.db.select().from(schema.connections).all();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const known = new Set<string>(providers);
    for (const [provider, ids] of Object.entries(input.accounts)) {
      if (!known.has(provider)) throw new InvalidOrderError("unknown provider");
      if (new Set(ids).size !== ids.length) throw new InvalidOrderError("duplicate account");
      for (const id of ids) {
        const row = byId.get(id);
        if (!row) throw new InvalidOrderError("unknown account");
        if (row.provider !== provider) throw new InvalidOrderError("account on another provider");
      }
    }

    const current = this.arrange(rows);
    const providerList = [
      ...input.providers,
      ...this.providerOrder().filter((provider) => !input.providers.includes(provider)),
    ];
    this.db.transaction((tx) => {
      const providersJson = JSON.stringify(providerList);
      const updatedAt = this.now();
      tx.insert(schema.displayOrder)
        .values({ id: ownerRow, providersJson, updatedAt })
        .onConflictDoUpdate({ target: schema.displayOrder.id, set: { providersJson, updatedAt } })
        .run();
      for (const [provider, listed] of Object.entries(input.accounts)) {
        const rest = current
          .filter((row) => row.provider === provider && !listed.includes(row.id))
          .map((row) => row.id);
        [...listed, ...rest].forEach((id, position) => {
          tx.update(schema.connections)
            .set({ position })
            .where(eq(schema.connections.id, id))
            .run();
        });
      }
    });
    return this.effective();
  }
}
