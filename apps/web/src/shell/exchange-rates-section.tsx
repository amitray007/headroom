import { useEffect, useState } from "react";

import { currencies, currencyName } from "@headroom/view-model/wallet-money";
import { formatNumber } from "@headroom/view-model/present";
import { age } from "@headroom/view-model/time";

import { refreshExchangeRates, useExchangeRates } from "../lib/exchange-rates.ts";
import { Button } from "../ui/button.tsx";
import { ErrorNotice } from "../ui/error-notice.tsx";
import { Section } from "./settings-rows.tsx";
import "./exchange-rates-section.css";

/** The server allows one fetch a minute; the button rests for the same time after a press. */
const restMs = 60_000;

/** A rate with enough digits to compare: more for small numbers, fewer for large ones. */
function rateText(rate: number): string {
  return formatNumber(rate, rate >= 100 ? 2 : 4);
}

/** Settings, General: where the Wallet's exchange rates come from, how fresh they are, and a Refresh button. */
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
  return (
    <Section title="Exchange Rates">
      <p className="xr-source muted">
        European Central Bank reference rates via Frankfurter. Headroom fetches them every 24 hours
        for the Wallet. They are daily rates, so converted totals are approximate.
      </p>
      {rates.error === null ? null : (
        <ErrorNotice inline>
          {rates.error}
          {rates.perUsd === null ? "" : " The rates below are the last good ones."}
        </ErrorNotice>
      )}
      {rates.perUsd === null ? (
        <p className="xr-empty muted">{busy ? "Loading rates." : "No rates yet."}</p>
      ) : (
        <>
          <dl className="xr-meta">
            <div>
              <dt className="muted">ECB date</dt>
              <dd className="num">{rates.date ?? "Unknown"}</dd>
            </div>
            <div>
              <dt className="muted">Fetched</dt>
              <dd>{rates.fetchedAt === null ? "Unknown" : age(rates.fetchedAt, now)}</dd>
            </div>
          </dl>
          <ul className="xr-grid" aria-label="Units per 1 US dollar">
            {currencies
              .filter((currency) => currency !== "USD")
              .map((currency) => {
                const rate = rates.perUsd?.[currency];
                return (
                  <li key={currency}>
                    <span className="xr-code" title={currencyName(currency)}>
                      {currency}
                    </span>
                    <span className="num">{rate === undefined ? "—" : rateText(rate)}</span>
                  </li>
                );
              })}
          </ul>
          <p className="xr-unit muted">Units of each currency per 1 USD.</p>
        </>
      )}
      <div className="xr-actions">
        <Button size="sm" busy={busy} busyLabel="Refreshing" disabled={resting} onClick={press}>
          Refresh Rates
        </Button>
        {resting && !busy ? (
          <span className="muted xr-rest">Wait a minute before refreshing again.</span>
        ) : null}
      </div>
    </Section>
  );
}
