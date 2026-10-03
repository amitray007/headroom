import { useState } from "react";

import { dayLabel } from "@headroom/view-model/wallet-dates";
import { parsePositive, type Currency } from "@headroom/view-model/wallet-money";
import type { WalletBook } from "@headroom/view-model/wallet";

import { TextField } from "../../shell/delivery/form-parts.tsx";
import { buttonClass } from "../../ui/button.tsx";
import { Popover } from "../../ui/menu.tsx";

function RateRow(props: {
  readonly currency: Currency;
  readonly rate: number | undefined;
  readonly onChange: (rate: number | null) => void;
}) {
  const [text, setText] = useState(props.rate === undefined ? "" : String(props.rate));
  const [touched, setTouched] = useState(false);
  const invalid = text.trim() !== "" && parsePositive(text) === null;
  return (
    <TextField
      label={`1 USD = … ${props.currency}`}
      value={text}
      inputMode="decimal"
      placeholder="0.00"
      error={touched && invalid ? "Enter a number above zero." : null}
      onBlur={() => setTouched(true)}
      onChange={(value) => {
        setText(value);
        const rate = parsePositive(value);
        if (rate !== null) props.onChange(rate);
        else if (value.trim() === "") props.onChange(null);
      }}
    />
  );
}

/**
 * The Exchange Rates button and its panel: one row per currency that needs a rate, always against USD ("1 USD = …
 * INR"). A currency with no rate stays out of converted totals.
 */
export function RatesPopover(props: {
  readonly book: WalletBook;
  /** The currencies that need a rate. USD needs none. */
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
      {props.currencies.map((currency) => (
        <RateRow
          key={currency}
          currency={currency}
          rate={props.book.perUsd[currency]}
          onChange={(rate) => props.onRate(currency, rate)}
        />
      ))}
    </Popover>
  );
}
