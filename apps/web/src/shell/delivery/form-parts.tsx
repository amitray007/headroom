import { useId, useState, type HTMLAttributes, type ReactNode } from "react";

import { ChevronDownIcon } from "../../icons.tsx";
import { cx } from "../../ui/cx.ts";
import { Fold } from "../../ui/fold.tsx";

/** A labelled text input with an error line and an optional amber warning. Show `error` only after a blur. */
export function TextField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onBlur?: () => void;
  readonly error?: string | null;
  readonly warning?: string | null;
  readonly placeholder?: string;
  readonly type?: "text" | "url";
  readonly inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const id = useId();
  const error = props.error ?? null;
  const warning = props.warning ?? null;
  const note = error ?? warning;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        inputMode={props.inputMode}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error === null ? undefined : true}
        aria-describedby={note === null ? undefined : `${id}-note`}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onBlur={props.onBlur}
      />
      {note === null ? null : (
        <p
          id={`${id}-note`}
          className={cx("dl-note", error === null ? "warn" : "bad")}
          role={error === null ? undefined : "alert"}
        >
          {note}
        </p>
      )}
    </div>
  );
}

/** A quiet toggle that folds extra content open under it. */
export function Disclosure(props: { readonly label: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="dl-disclosure">
      <button
        type="button"
        className="dl-disclosure-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        {props.label}
        <ChevronDownIcon />
      </button>
      <Fold id={id} closed={!open}>
        <div className="dl-disclosure-body">{props.children}</div>
      </Fold>
    </div>
  );
}

/** One error line for a flow step. Empty when there is nothing to say. */
export function Problem(props: { readonly children: string | null }) {
  return props.children === null ? null : (
    <p className="form-error dl-problem" role="alert">
      {props.children}
    </p>
  );
}
