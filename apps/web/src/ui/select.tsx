import { useId, useMemo, type ReactNode } from "react";

import { ChevronDownIcon } from "../icons.tsx";
import { ListboxPanel, orderItems, useListbox } from "./listbox.tsx";
import "./fields.css";

/** One choice in a `Select`. Options with the same `group` sit under that group's heading, in the order given. */
export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Muted text after the label, such as a plan. */
  readonly meta?: string;
  /** A second line in a `.who` span, so Privacy Mode blurs it (an email). */
  readonly detail?: string;
  /** A leading mark, such as a provider logo. */
  readonly icon?: ReactNode;
  readonly group?: string;
}

/**
 * Arc's select, built natively: a field-styled trigger that opens a listbox popover with keyboard support
 * (arrows, Home/End, typeahead, Enter/Space, Escape). Rich options carry an icon, meta and a blurrable detail.
 */
export function Select<T extends string>(props: {
  readonly label: string;
  readonly hideLabel?: boolean;
  readonly value: T | null;
  readonly options: readonly SelectOption<T>[];
  readonly onChange: (value: T) => void;
  readonly placeholder?: string;
  readonly error?: string | null;
  readonly size?: "sm" | "md";
}) {
  const id = useId();
  const { onChange } = props;
  const ordered = useMemo(() => orderItems(props.options), [props.options]);
  const { box, triggerRef, panelRef } = useListbox({
    items: ordered,
    value: props.value,
    onPick: (value) => {
      const hit = ordered.find((option) => option.value === value);
      if (hit !== undefined) onChange(hit.value);
    },
    gap: 6,
    align: "start",
    matchWidth: true,
  });
  const chosen = box.selected >= 0 ? ordered[box.selected] : undefined;
  const error = props.error ?? null;
  const small = props.size === "sm";
  return (
    <div className="field fld" data-size={small ? "sm" : undefined}>
      <label
        id={`${id}-label`}
        htmlFor={`${id}-trigger`}
        className={props.hideLabel === true ? "sr" : undefined}
      >
        {props.label}
      </label>
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        className="fld-trigger"
        data-size={small ? "sm" : undefined}
        data-invalid={error === null ? undefined : ""}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-describedby={error === null ? undefined : `${id}-note`}
        {...box.triggerProps}
      >
        <span id={`${id}-value`} className="fld-value">
          {chosen === undefined ? (
            <span className="fld-ph">{props.placeholder ?? "Select an option"}</span>
          ) : (
            <>
              {chosen.icon === undefined ? null : <span className="fld-icon">{chosen.icon}</span>}
              <span className="fld-main">{chosen.label}</span>
              {chosen.meta === undefined ? null : <span className="fld-sub">{chosen.meta}</span>}
              {chosen.detail === undefined ? null : (
                <span className="who fld-sub">{chosen.detail}</span>
              )}
            </>
          )}
        </span>
        <span className="fld-chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>
      <ListboxPanel box={box} panelRef={panelRef} label={props.label} />
      {error === null ? null : (
        <p id={`${id}-note`} className="dl-note bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
