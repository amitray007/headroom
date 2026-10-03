import { useState } from "react";

import { LoadFailed, NoAccounts } from "../../dashboard/states.tsx";
import { PlusIcon } from "../../icons.tsx";
import { useDevicePrefs } from "../../lib/device-prefs.ts";
import { useNow } from "../../lib/now.ts";
import { useWalletBook } from "../../lib/wallet-store.ts";
import { localDay } from "@headroom/view-model/wallet-dates";
import {
  currencies,
  currencyName,
  currencySymbol,
  type Currency,
} from "@headroom/view-model/wallet-money";
import { demoWallet } from "@headroom/view-model/wallet-demo";
import { rateCurrencies, summarize, type Cost, type TopUp } from "@headroom/view-model/wallet";
import { Button } from "../../ui/button.tsx";
import { Select, type SelectOption } from "../../ui/select.tsx";
import type { ViewProps } from "../props.ts";
import { ProviderBlock } from "./accounts.tsx";
import { withCost, withDisplay, withRate, withTopUp, withoutTopUp } from "./book.ts";
import { CostDialog } from "./cost-dialog.tsx";
import { RenewalsCard, TopUpsCard } from "./glance.tsx";
import { RatesPopover } from "./rates-popover.tsx";
import { WalletSkeleton } from "./skeleton.tsx";
import { SpendByProvider } from "./spend.tsx";
import { SummaryBand } from "./summary.tsx";
import { TopUpDialog } from "./topup-dialog.tsx";
import { TopUpsSection } from "./topups.tsx";
import "./wallet.css";

/** "INR" with "₹ · Indian rupee" beside it. */
const currencyOptions: readonly SelectOption<Currency>[] = currencies.map((currency) => ({
  value: currency,
  label: currency,
  meta: `${currencySymbol(currency)} · ${currencyName(currency)}`,
}));

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
  /** The top-up dialog: closed (null), or open on an account (its id) or on the first one (null id). */
  const [topUpFor, setTopUpFor] = useState<{ readonly connectionId: string | null } | null>(null);

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

  const today = localDay(now);
  const summary = summarize(
    connections,
    providerOrder,
    book,
    // `summarize` reads its day in UTC; midnight UTC of the owner's local day makes "today" and "this month" match
    // the dates the dialogs fill in.
    Date.parse(`${today}T00:00:00Z`),
    typeof navigator === "undefined" ? "en-US" : navigator.language,
  );
  const display = summary.currency;
  const rated = rateCurrencies(book, display);
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
        <h1 className="w-title">Wallet</h1>
        <div className="w-segs">
          <Select
            label="Currency"
            hideLabel
            size="sm"
            value={display}
            options={currencyOptions}
            onChange={(next) => setBook(withDisplay(book, next))}
          />
          {rated.length === 0 ? null : (
            <RatesPopover
              book={book}
              currencies={rated}
              onRate={(currency, rate) => setBook(withRate(book, currency, rate, today))}
            />
          )}
          <Button
            variant="primary"
            size="sm"
            icon={<PlusIcon />}
            onClick={() => setTopUpFor({ connectionId: null })}
          >
            Add Top-Up
          </Button>
        </div>
      </div>
      <SummaryBand summary={summary} connections={connections} />
      <div className="w-glance">
        <SpendByProvider summary={summary} />
        <div className="w-side">
          <TopUpsCard summary={summary} />
          <RenewalsCard summary={summary} connections={connections} />
        </div>
      </div>
      {summary.providers.map((group) => (
        <ProviderBlock
          key={group.provider}
          group={group}
          onEdit={setCostFor}
          onAddTopUp={(connectionId) => setTopUpFor({ connectionId })}
        />
      ))}
      <TopUpsSection
        topUps={summary.topUps}
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
        open={topUpFor !== null}
        connections={connections}
        providerOrder={providerOrder}
        connectionId={topUpFor?.connectionId ?? null}
        defaultCurrency={display}
        today={today}
        onAdd={addTopUp}
        onClose={() => setTopUpFor(null)}
      />
    </div>
  );
}
