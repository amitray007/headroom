import { useId, useState } from "react";

import { dayLabel } from "@headroom/view-model/wallet-dates";
import { currencySymbol, parsePositive, type Currency } from "@headroom/view-model/wallet-money";
import type { WalletBook } from "@headroom/view-model/wallet";

import { buttonClass } from "../../ui/button.tsx";
import { Popover } from "../../ui/menu.tsx";

function RateRow(props: {
  readonly currency: Currency;
  readonly rate: number | undefined;
  readonly onChange: (rate: number | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState(props.rate === undefined ? "" : String(props.rate));
  const [touched, setTouched] = useState(false);
  const invalid = text.trim() !== "" && parsePositive(text) === null;
  const showError = touched && invalid;
  return (
    <div className="w-rate">
      <label htmlFor={id}>
        <span className="w-rate-code">{props.currency}</span>
        <span className="muted" aria-hidden="true">
          {currencySymbol(props.currency)}
        </span>
      </label>
      <input
        id={id}
        value={text}
        inputMode="decimal"
        placeholder="Not set"
        aria-label={`${props.currency} per 1 USD`}
        aria-invalid={showError ? true : undefined}
        aria-describedby={showError ? `${id}-note` : undefined}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onBlur={() => setTouched(true)}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setText(value);
          const rate = parsePositive(value);
          if (rate !== null) props.onChange(rate);
          else if (value.trim() === "") props.onChange(null);
        }}
      />
      {showError ? (
        <p id={`${id}-note`} className="dl-note bad" role="alert">
          Enter a number above zero.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Exchange Rates button and its panel: a compact two-column grid with a field per currency, always against USD
 * ("1 USD equals" 95 INR). A currency with no rate stays out of converted totals.
 */
export function RatesPopover(props: {
  readonly book: WalletBook;
  /** The currencies that take a rate, in the order to show them. USD needs none. */
  readonly currencies: readonly Currency[];
  readonly onRate: (currency: Currency, rate: number | null) => void;
}) {
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
          Your own rates.
          {props.book.ratesChangedOn === null
            ? ""
            : ` Last changed ${dayLabel(props.book.ratesChangedOn)}`}
        </p>
      </div>
      <p className="w-rates-lead muted">1 USD equals</p>
      <div className="w-rates-grid">
        {props.currencies.map((currency) => (
          <RateRow
            key={currency}
            currency={currency}
            rate={props.book.perUsd[currency]}
            onChange={(rate) => props.onRate(currency, rate)}
          />
        ))}
      </div>
    </Popover>
  );
}
