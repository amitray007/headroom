import { useState } from "react";

import type { Currency, WalletBook } from "@headroom/view-model/wallet";

import { buttonClass } from "../../ui/button.tsx";
import { Popover } from "../../ui/menu.tsx";
import { parsePositive } from "./book.ts";

function RateRow(props: {
  readonly currency: Currency;
  readonly rate: number | undefined;
  readonly onChange: (rate: number | null) => void;
}) {
  const [text, setText] = useState(props.rate === undefined ? "" : String(props.rate));
  const invalid = text.trim() !== "" && parsePositive(text) === null;
  return (
    <div className="w-rate">
      <span>1 USD =</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={`${props.currency} per 1 USD`}
        aria-invalid={invalid ? true : undefined}
        placeholder="0.00"
        value={text}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setText(value);
          const rate = parsePositive(value);
          if (rate !== null) props.onChange(rate);
          else if (value.trim() === "") props.onChange(null);
        }}
      />
      <span>{props.currency}</span>
    </div>
  );
}

/**
 * The Exchange Rates button and its small panel: one row per non-USD currency in use, "1 USD = [rate] INR".
 * A currency with no rate stays out of converted totals.
 */
export function RatesPopover(props: {
  readonly book: WalletBook;
  /** The currencies the book uses. USD needs no row. */
  readonly used: readonly Currency[];
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
        <p className="muted">Your own rates. They only convert totals.</p>
      </div>
      {props.used
        .filter((currency) => currency !== "USD")
        .map((currency) => (
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
