import { useEffect, useState } from "react";

import { currencies, currencyName } from "@headroom/view-model/wallet-money";
import { formatNumber } from "@headroom/view-model/present";
import { age } from "@headroom/view-model/time";
import { dayLabel } from "@headroom/view-model/wallet-dates";

import { RetryIcon } from "../icons.tsx";
import { refreshExchangeRates, useExchangeRates } from "../lib/exchange-rates.ts";
import { Button } from "../ui/button.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { Body, Section } from "./settings-rows.tsx";
import "./exchange-rates-section.css";

/** The server allows one fetch a minute; the button rests for the same time after a press. */
const restMs = 60_000;

/** A rate with enough digits to compare: more for small numbers, fewer for large ones. */
function rateText(rate: number): string {
  return formatNumber(rate, rate >= 100 ? 2 : 4);
}

/** Settings, General: where the Wallet's exchange rates come from, how fresh they are, and a refresh button. */
export function ExchangeRatesSection() {
  const rates = useExchangeRates();
  const [pressedAt, setPressedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // One tick a few seconds keeps "5 min ago" honest and ends the rest after a press.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const busy = rates.status === "refreshing" || rates.status === "loading";
  const resting = pressedAt !== null && now - pressedAt < restMs;
  const press = (): void => {
    const at = Date.now();
    setPressedAt(at);
    setNow(at);
    void refreshExchangeRates();
  };
  const status = [
    rates.fetchedAt === null ? null : `Updated ${age(rates.fetchedAt, now).toLowerCase()}`,
    rates.date === null ? null : `ECB ${dayLabel(rates.date)}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <Section title="Exchange Rates">
      <div className="srow">
        <Body title="Rates" note="Daily ECB rates. Wallet totals are approximate." />
        <span className="xr-status">
          {status === "" ? null : <span className="muted">{status}</span>}
          <Button
            variant="quiet"
            size="sm"
            aria-label="Refresh Rates"
            title={resting ? "Refreshed. Try again in a minute." : "Refresh Rates"}
            busy={busy}
            busyLabel="Refreshing"
            disabled={resting}
            onClick={press}
          >
            <RetryIcon />
          </Button>
        </span>
      </div>
      {rates.error === null ? null : (
        <ErrorNotice inline>
          {rates.error}
          {rates.perUsd === null ? "" : " The rates below are the last good ones."}
        </ErrorNotice>
      )}
      {rates.perUsd === null ? (
        <p className="xr-empty muted">{busy ? "Loading rates." : "No rates yet."}</p>
      ) : (
        <div className="xr-card">
          <table className="xr-table">
            <thead>
              <tr>
                <th scope="col">Currency</th>
                <th scope="col">Per 1 USD</th>
                <th scope="col">1 Unit in USD</th>
              </tr>
            </thead>
            <tbody>
              {currencies
                .filter((currency) => currency !== "USD")
                .map((currency) => {
                  const rate = rates.perUsd?.[currency];
                  return (
                    <tr key={currency}>
                      <th scope="row">
                        <span className="xr-code">{currency}</span>
                        <span className="muted">{currencyName(currency)}</span>
                      </th>
                      <td className="num">{rate === undefined ? "—" : rateText(rate)}</td>
                      <td className="num">{rate === undefined ? "—" : rateText(1 / rate)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
