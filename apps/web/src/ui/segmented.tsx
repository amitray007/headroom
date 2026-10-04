import { cx } from "./cx.ts";

/** A row of mutually exclusive options. `full` spreads them across the width of the container. */
export function Segmented<T extends string>(props: {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  /** Accessible name of the group. */
  readonly label: string;
  readonly full?: boolean;
}) {
  return (
    <fieldset className={cx("seg", props.full === true && "full")} aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === props.value}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
