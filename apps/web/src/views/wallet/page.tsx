import { useState } from "react";

import { LoadFailed, NoAccounts } from "../../dashboard/states.tsx";
import { PlusIcon } from "../../icons.tsx";
import { useDevicePrefs } from "../../lib/device-prefs.ts";
import { useNow } from "../../lib/now.ts";
import { useWalletBook } from "../../lib/wallet-store.ts";
import { demoWallet } from "@headroom/view-model/wallet-demo";
import { summarize, type Cost, type TopUp } from "@headroom/view-model/wallet";
import { Button } from "../../ui/button.tsx";
import { Segmented } from "../../ui/segmented.tsx";
import type { ViewProps } from "../props.ts";
import { ProviderBlock } from "./accounts.tsx";
import {
  dayOf,
  effectiveCurrency,
  usedCurrencies,
  withCost,
  withDisplay,
  withRate,
  withTopUp,
  withoutTopUp,
} from "./book.ts";
import { CostDialog } from "./cost-dialog.tsx";
import { RatesPopover } from "./rates-popover.tsx";
import { WalletSkeleton } from "./skeleton.tsx";
import { SummaryBand } from "./summary.tsx";
import { TopUpDialog } from "./topup-dialog.tsx";
import { TopUpsSection } from "./topups.tsx";
import "./wallet.css";

/**
 * Wallet: what the owner pays for each account, in money. Subscription costs and top-ups are entered by the
 * owner and kept in this browser; usage spend comes from the provider's own figures. An account with no cost
 * is Not set, never zero.
 */
export function WalletPage(props: ViewProps) {
  const { connections, providerOrder, failed, stale, reload } = props.overview;
  const prefs = useDevicePrefs();
  const now = useNow();
  const [retrying, setRetrying] = useState(false);
  const [costFor, setCostFor] = useState<string | null>(null);
  const [addingTopUp, setAddingTopUp] = useState(false);

  // Demo Mode keeps its own book in memory, so its edits never reach the saved one.
  const [book, setBook] = useWalletBook(
    prefs.demo && connections !== null
      ? {
          key: `${prefs.demoSeed}:${prefs.demoAnchor}`,
          make: () => demoWallet(prefs.demoSeed, connections, prefs.demoAnchor),
        }
      : null,
  );

  const retry = (): void => {
    setRetrying(true);
    void reload().finally(() => setRetrying(false));
  };

  if (connections === null) {
    return failed ? (
      <LoadFailed stale={false} busy={retrying} onRetry={retry} />
    ) : (
      <WalletSkeleton />
    );
  }
  if (connections.length === 0) {
    return (
      <div className="reveal">
        <NoAccounts />
      </div>
    );
  }

  const used = usedCurrencies(book);
  const display = effectiveCurrency(book);
  const shown = withDisplay(book, display);
  const summary = summarize(connections, providerOrder, shown, now);
  const month = dayOf(now).slice(0, 7);
  const paidTopUps = book.topUps.filter(
    (topUp) => topUp.kind === "paid" && topUp.date.startsWith(month),
  ).length;
  const editing = summary.providers
    .flatMap((group) => group.accounts)
    .find((account) => account.connection.id === costFor);

  const saveCost = (connectionId: string, cost: Cost | null): void =>
    setBook(withCost(book, connectionId, cost));
  const addTopUp = (topUp: TopUp): void => setBook(withTopUp(book, topUp));

  return (
    <div className="reveal w-page">
      {stale ? <LoadFailed stale busy={retrying} onRetry={retry} /> : null}
      <div className="w-tools">
        <p className="w-caption muted">
          {prefs.demo
            ? "Made-up figures. Nothing here is saved."
            : "What you enter here stays in this browser."}
        </p>
        <div className="w-segs">
          {used.length > 1 ? (
            <>
              <Segmented
                label="Show in"
                value={display}
                options={used.map((currency) => ({ value: currency, label: currency }))}
                onChange={(next) => setBook(withDisplay(book, next))}
              />
              <RatesPopover
                book={book}
                used={used}
                onRate={(currency, rate) => setBook(withRate(book, currency, rate))}
              />
            </>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            icon={<PlusIcon />}
            onClick={() => setAddingTopUp(true)}
          >
            Add Top-Up
          </Button>
        </div>
      </div>
      <SummaryBand summary={summary} paidTopUps={paidTopUps} />
      {summary.providers.map((group) => (
        <ProviderBlock
          key={group.provider}
          group={group}
          display={display}
          perUsd={book.perUsd}
          onEdit={setCostFor}
        />
      ))}
      <TopUpsSection
        topUps={book.topUps}
        connections={connections}
        onRemove={(id) => setBook(withoutTopUp(book, id))}
      />
      <CostDialog
        account={editing ?? null}
        defaultCurrency={display}
        onSave={saveCost}
        onClose={() => setCostFor(null)}
      />
      <TopUpDialog
        open={addingTopUp}
        connections={connections}
        providerOrder={providerOrder}
        defaultCurrency={display}
        today={dayOf(now)}
        onAdd={addTopUp}
        onClose={() => setAddingTopUp(false)}
      />
    </div>
  );
}
