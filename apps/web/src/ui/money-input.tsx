import { currencyName, currencySymbol, minorDigits } from "@headroom/view-model/wallet-money";
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";

import { ChevronDownIcon } from "../icons.tsx";
import { ListboxPanel, useListbox } from "./listbox.tsx";
import {
  caretAfter,
  draftToMinor,
  formatDraft,
  groupingLocale,
  minorToDraft,
  parseDraft,
  placeholderFor,
  rescaleMinor,
  significantBefore,
} from "./money.ts";
import "./fields.css";

/**
 * Arc's money input, built natively: one field with the currency symbol inside, a currency menu at its end,
 * live grouping as you type, and minor-unit output (cents, paise). `minor` is null while the field is empty
 * or not a number.
 */
export function MoneyInput<C extends string>(props: {
  readonly label: string;
  readonly minor: number | null;
  readonly currency: C;
  /** The currencies the menu offers. One entry locks the currency and shows it as static text. */
  readonly currencies: readonly C[];
  readonly onChange: (next: { readonly minor: number | null; readonly currency: C }) => void;
  readonly hint?: string;
  readonly error?: string | null;
}) {
  const id = useId();
  const { minor, currency, currencies, onChange } = props;
  const digits = minorDigits(currency);
  const locale = groupingLocale(currency);
  const inputRef = useRef<HTMLInputElement>(null);

  // The draft is what is typed ("12." or "12.50"); `minor` is what it means. An outside change to either wins.
  const [draft, setDraft] = useState(() => minorToDraft(minor, digits));
  const [seen, setSeen] = useState({ minor, digits });
  if (seen.minor !== minor || seen.digits !== digits) {
    setSeen({ minor, digits });
    if (seen.digits !== digits || draftToMinor(draft, digits) !== minor) {
      setDraft(minorToDraft(minor, digits));
    }
  }
  const display = formatDraft(draft, locale);

  // Put the caret back after the digits it followed, since grouping commas shift every position after them.
  const caret = useRef<number | null>(null);
  const [, setTick] = useState(0);
  useLayoutEffect(() => {
    const input = inputRef.current;
    const count = caret.current;
    caret.current = null;
    if (input === null || count === null || document.activeElement !== input) return;
    const at = caretAfter(input.value, count);
    input.setSelectionRange(at, at);
  });

  const onInput = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.currentTarget.value;
    const next = parseDraft(raw, digits);
    caret.current = significantBefore(
      raw,
      event.currentTarget.selectionStart ?? raw.length,
      digits,
    );
    setDraft(next);
    setTick((value) => value + 1);
    onChange({ minor: draftToMinor(next, digits), currency });
  };

  const options = useMemo(
    () =>
      currencies.map((code) => ({
        value: code,
        label: code,
        meta: currencyName(code),
        icon: <span className="mi-sym">{currencySymbol(code)}</span>,
      })),
    [currencies],
  );
  const { box, triggerRef, panelRef } = useListbox({
    items: options,
    value: currency,
    onPick: (value) => {
      const code = currencies.find((entry) => entry === value);
      if (code === undefined) return;
      onChange({ minor: rescaleMinor(minor, digits, minorDigits(code)), currency: code });
    },
    gap: 12,
    align: "end",
    matchWidth: false,
  });

  const error = props.error ?? null;
  const note = error ?? props.hint ?? null;
  const focusInput = (event: PointerEvent<HTMLDivElement>): void => {
    const target = event.target;
    const onSymbol = target instanceof Element && target.classList.contains("mi-symbol");
    if (target !== event.currentTarget && !onSymbol) return;
    event.preventDefault();
    inputRef.current?.focus();
  };

  return (
    <div className="field fld">
      <label htmlFor={`${id}-input`}>{props.label}</label>
      <div
        className="mi"
        role="presentation"
        data-invalid={error === null ? undefined : ""}
        onPointerDown={focusInput}
      >
        <span className="mi-symbol" aria-hidden="true">
          {currencySymbol(currency)}
        </span>
        <input
          ref={inputRef}
          id={`${id}-input`}
          className="mi-input"
          type="text"
          inputMode={digits > 0 ? "decimal" : "numeric"}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholderFor(digits)}
          value={display}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={note === null ? undefined : `${id}-note`}
          onChange={onInput}
          onBlur={() => {
            // Settle "12.5" to "12.50" once you leave the field.
            if (draft !== "") setDraft(minorToDraft(draftToMinor(draft, digits), digits));
          }}
        />
        {currencies.length > 1 ? (
          <button
            ref={triggerRef}
            type="button"
            className="mi-currency"
            aria-label={`${props.label} currency: ${currency}`}
            {...box.triggerProps}
          >
            <span className="mi-code">{currency}</span>
            <span className="fld-chevron" aria-hidden="true">
              <ChevronDownIcon />
            </span>
          </button>
        ) : (
          <span className="mi-code">{currency}</span>
        )}
      </div>
      {currencies.length > 1 ? (
        <ListboxPanel
          box={box}
          panelRef={panelRef}
          label={`${props.label} currency`}
          className="fpop-money"
        />
      ) : null}
      {note === null ? null : (
        <p
          id={`${id}-note`}
          className={error === null ? "dl-note hint" : "dl-note bad"}
          role={error === null ? undefined : "alert"}
        >
          {note}
        </p>
      )}
    </div>
  );
}
