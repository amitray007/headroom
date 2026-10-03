import { useId, type ReactNode } from "react";

import { cx } from "../../ui/cx.ts";

/** A labelled native select, styled like the app's text inputs. Options go in as children. */
export function SelectField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.children}
      </select>
    </div>
  );
}

/** A labelled native date input, in the same box as the text inputs. The value is `YYYY-MM-DD` or empty. */
export function DateField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly required?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="date"
        value={props.value}
        required={props.required === true}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  );
}

/** A label above a control that has no single input, such as a segmented choice. */
export function GroupField(props: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={cx("field", props.className)}>
      <span className="w-label">{props.label}</span>
      {props.children}
    </div>
  );
}
