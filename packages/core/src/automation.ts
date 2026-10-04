import { and, eq } from "drizzle-orm";

import {
  autoResetRuleSchema,
  spendBudgetSchema,
  type AutoResetRule,
  type SpendBudget,
} from "./automation-schemas.ts";
import { type Db, schema } from "./db/index.ts";
import type { NotificationAmountUnit } from "./enums.ts";
import { UnknownConnectionError } from "./wallet.ts";

/**
 * The owner's automation settings: one auto-reset rule and any number of spend budgets per
 * account (ADR 0003). A missing row means no rule and no budget; nothing is stored as zero.
 */

type RuleRow = typeof schema.autoResetRules.$inferSelect;
type BudgetRow = typeof schema.spendBudgets.$inferSelect;

function ruleFromRow(row: RuleRow): AutoResetRule | null {
  const parsed = autoResetRuleSchema.safeParse({
    enabled: row.enabled,
    window: row.window,
    thresholdPercent: row.thresholdPercent,
    minHoursLeft: row.minHoursLeft,
  });
  return parsed.success ? parsed.data : null;
}

function budgetFromRow(row: BudgetRow): SpendBudget | null {
  const parsed = spendBudgetSchema.safeParse({
    metricKey: row.metricKey,
    amount: row.amount,
    unit: row.unit,
  });
  return parsed.success ? parsed.data : null;
}

export class AutomationStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  autoReset(connectionId: string): AutoResetRule | null {
    const row = this.db
      .select()
      .from(schema.autoResetRules)
      .where(eq(schema.autoResetRules.connectionId, connectionId))
      .get();
    return row ? ruleFromRow(row) : null;
  }

  /** Every account's rule, keyed by connection id. One statement. */
  autoResetRules(): Map<string, AutoResetRule> {
    const rules = new Map<string, AutoResetRule>();
    for (const row of this.db.select().from(schema.autoResetRules).all()) {
      const rule = ruleFromRow(row);
      if (rule) rules.set(row.connectionId, rule);
    }
    return rules;
  }

  /** Insert or replace. The caller validated the rule with `autoResetRuleSchema`. */
  setAutoReset(connectionId: string, rule: AutoResetRule): void {
    this.requireConnection(connectionId);
    const values = {
      enabled: rule.enabled,
      window: rule.window,
      thresholdPercent: rule.thresholdPercent,
      minHoursLeft: rule.minHoursLeft,
      updatedAt: this.now(),
    };
    this.db
      .insert(schema.autoResetRules)
      .values({ connectionId, ...values })
      .onConflictDoUpdate({ target: schema.autoResetRules.connectionId, set: values })
      .run();
  }

  clearAutoReset(connectionId: string): void {
    this.db
      .delete(schema.autoResetRules)
      .where(eq(schema.autoResetRules.connectionId, connectionId))
      .run();
  }

  budgets(connectionId: string): SpendBudget[] {
    return this.db
      .select()
      .from(schema.spendBudgets)
      .where(eq(schema.spendBudgets.connectionId, connectionId))
      .orderBy(schema.spendBudgets.metricKey)
      .all()
      .flatMap((row) => budgetFromRow(row) ?? []);
  }

  /** Every account's budgets, keyed by connection id. One statement. */
  allBudgets(): Map<string, SpendBudget[]> {
    const grouped = new Map<string, SpendBudget[]>();
    for (const row of this.db
      .select()
      .from(schema.spendBudgets)
      .orderBy(schema.spendBudgets.metricKey)
      .all()) {
      const budget = budgetFromRow(row);
      if (!budget) continue;
      const group = grouped.get(row.connectionId);
      if (group) group.push(budget);
      else grouped.set(row.connectionId, [budget]);
    }
    return grouped;
  }

  setBudget(
    connectionId: string,
    metricKey: string,
    amount: number,
    unit: NotificationAmountUnit,
  ): void {
    this.requireConnection(connectionId);
    const values = { amount, unit, updatedAt: this.now() };
    this.db
      .insert(schema.spendBudgets)
      .values({ connectionId, metricKey, ...values })
      .onConflictDoUpdate({
        target: [schema.spendBudgets.connectionId, schema.spendBudgets.metricKey],
        set: values,
      })
      .run();
  }

  clearBudget(connectionId: string, metricKey: string): void {
    this.db
      .delete(schema.spendBudgets)
      .where(
        and(
          eq(schema.spendBudgets.connectionId, connectionId),
          eq(schema.spendBudgets.metricKey, metricKey),
        ),
      )
      .run();
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
