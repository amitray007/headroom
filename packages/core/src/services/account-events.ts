import type { AccountEventStore } from "../account-events.ts";
import type { ActionStore } from "../actions.ts";
import {
  detectAccountEvents,
  readingFromCollect,
  readingFromStored,
} from "../account-event-detection.ts";
import type { CollectResult } from "../connector.ts";
import type { Provider } from "../enums.ts";
import type { SnapshotStore } from "../snapshots.ts";
import type { WalletStore } from "../wallet.ts";

/**
 * Turns each new reading into account events (ADR 0003). The collection service calls `observe`
 * after it stored a snapshot. A detected top-up first becomes a Wallet row, then the event that
 * names it. Nothing here may fail a collection: the caller swallows a throw.
 */

export interface ObservedCollection {
  readonly connectionId: string;
  readonly provider: Provider;
  /** The newest snapshot before this one, or null on the first collection. */
  readonly previous: ReturnType<SnapshotStore["latest"]>;
  readonly result: CollectResult;
}

export interface AccountEventServiceOptions {
  readonly events: AccountEventStore;
  readonly wallet: Pick<WalletStore, "addTopUp">;
  readonly actions: Pick<ActionStore, "explainsChangeSince">;
}

export class AccountEventService {
  constructor(private readonly deps: AccountEventServiceOptions) {}

  observe(input: ObservedCollection): void {
    if (!input.previous) return;
    const { result } = input;
    const drafts = detectAccountEvents({
      provider: input.provider,
      previous: readingFromStored(input.previous),
      current: readingFromCollect(result),
      observedAt: result.observedAt,
      actionSincePrevious: this.deps.actions.explainsChangeSince(
        input.connectionId,
        input.previous.snapshot.observedAt,
      ),
    });
    for (const draft of drafts) {
      let { detail } = draft;
      // The Wallet records credits; a money balance (Claude, in USD) keeps the event without a Wallet entry.
      if (detail.kind === "top_up_detected" && detail.unit !== "USD") {
        let topUpId: string | null = null;
        try {
          topUpId = this.deps.wallet.addTopUp(
            {
              connectionId: input.connectionId,
              date: new Date(result.observedAt).toISOString().slice(0, 10),
              kind: "paid",
              price: null,
              credits: detail.added,
              note: null,
              expiresOn: null,
              expiryAlertDays: null,
            },
            "detected",
          ).id;
        } catch {
          // The event still records the rise; its topUpId stays null.
        }
        detail = { ...detail, topUpId };
      }
      this.deps.events.record(input.connectionId, result.observedAt, draft.metricKey, detail);
    }
  }
}
