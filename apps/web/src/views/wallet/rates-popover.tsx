import { useEffect, useState } from "react";

import { age } from "@headroom/view-model/time";
import { dayLabel } from "@headroom/view-model/wallet-dates";
import { currencySymbol, type Currency } from "@headroom/view-model/wallet-money";

import type { ExchangeRates } from "../../lib/exchange-rates.ts";
import { useNow } from "../../lib/now.ts";
import { Button, buttonClass } from "../../ui/button.tsx";
import { Popover } from "../../ui/menu.tsx";

/** The server fetches at most once a minute when asked, so the button waits as long. */
const cooldownMs = 60_000;

/** "96.32", "0.89087", "157.67": the five significant digits the ECB publishes, never padded. */
function formatRate(rate: number): string {
  return rate.toLocaleString("en-US", { maximumSignificantDigits: 5 });
}

function RateRow(props: { readonly currency: Currency; readonly rate: number | undefined }) {
  return (
    <div className="w-rate">
      <dt>
        <span className="w-rate-code">{props.currency}</span>
        <span className="muted" aria-hidden="true">
          {currencySymbol(props.currency)}
        </span>
      </dt>
      <dd className={props.rate === undefined ? "muted" : undefined}>
        {props.rate === undefined ? "Not available" : formatRate(props.rate)}
      </dd>
    </div>
  );
}

/** Refresh stays off for a minute after a fetch, whether this press or the server's own timer made it. */
function RefreshButton(props: { readonly rates: ExchangeRates }) {
  const { rates } = props;
  const [pressedUntil, setPressedUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const until = Math.max(pressedUntil, (rates.fetchedAt ?? 0) + cooldownMs);
  useEffect(() => {
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);
  const refreshing = rates.status === "refreshing" || rates.status === "loading";
  const cooling = !refreshing && clock < until;
  return (
    <span title={cooling ? "Rates can be refreshed once a minute." : undefined}>
      <Button
        variant="quiet"
        size="sm"
        busy={refreshing}
        disabled={cooling}
        onClick={() => {
          setPressedUntil(Date.now() + cooldownMs);
          void rates.refresh();
        }}
      >
        Refresh
      </Button>
    </span>
  );
}

function updatedText(rates: ExchangeRates, now: number): string {
  if (rates.status === "refreshing" || rates.status === "loading") return "Updating…";
  if (rates.fetchedAt === null) return "Not updated yet";
  const ago = age(rates.fetchedAt, now);
  return `Updated ${ago === "Just now" ? "just now" : ago}`;
}

/**
 * The Exchange Rates button and its panel: the server's rates, read-only, always against USD ("1 USD equals"
 * 96.32 INR). A currency with no rate stays out of converted totals; Refresh asks the server to fetch again.
 */
export function RatesPopover(props: {
  readonly rates: ExchangeRates;
  /** The currencies to list, currencies in use first. USD is the base and needs no row. */
  readonly currencies: readonly Currency[];
}) {
  const { rates } = props;
  const now = useNow();
  const unavailable = rates.perUsd === null && rates.status !== "loading";
  return (
    <Popover
      label="Exchange Rates"
      panelLabel="Exchange Rates"
      panelClassName="notif w-rates-pop"
      triggerClassName={buttonClass("default", "sm")}
      trigger="Exchange Rates"
    >
      <div className="w-pop-head">
        <h2>Exchange Rates</h2>
        <p className="muted">
          European Central Bank reference rates
          {rates.date === null ? "" : ` · ${dayLabel(rates.date)}`}
        </p>
      </div>
      {unavailable ? (
        <p className="w-rates-note muted">
          Rates could not be fetched. Amounts in other currencies stay out of totals.
        </p>
      ) : (
        <>
          <p className="w-rates-lead muted">1 USD equals</p>
          <dl className="w-rates-grid">
            {props.currencies.map((currency) => (
              <RateRow key={currency} currency={currency} rate={rates.perUsd?.[currency]} />
            ))}
          </dl>
          {rates.error !== null && rates.perUsd !== null ? (
            <p className="w-rates-note muted">The last refresh failed, so these rates are older.</p>
          ) : null}
        </>
      )}
      <div className="w-rates-foot">
        <p className="muted">{unavailable ? "" : updatedText(rates, now)}</p>
        <RefreshButton rates={rates} />
      </div>
    </Popover>
  );
}
