import { cx } from "./cx.ts";

/** A row of mutually exclusive options. `full` spreads them across the width of the container. */
export function Segmented<T extends string>(props: {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly {
    readonly value: T;
    readonly label: string;
    /** Dims this option and ignores presses. */
    readonly disabled?: boolean;
  }[];
  /** Accessible name of the group. */
  readonly label: string;
  readonly full?: boolean;
  /** Dims the options and ignores presses; the value stays shown. */
  readonly disabled?: boolean;
}) {
  return (
    <fieldset
      className={cx("seg", props.full === true && "full")}
      aria-label={props.label}
      disabled={props.disabled === true}
    >
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === props.value}
          disabled={option.disabled === true}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
