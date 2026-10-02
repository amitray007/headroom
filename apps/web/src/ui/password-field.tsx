import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { cx } from "./cx.ts";

/** One eye. A slash is drawn across it and cuts the outline beneath, instead of swapping two icons. */
function EyeMorph() {
  const mask = `eye-${useId().replaceAll(":", "")}`;
  const slash = "M3 3l18 18";
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path className="pw-slash" d={slash} pathLength="1" stroke="black" strokeWidth="5" />
      </mask>
      <g mask={`url(#${mask})`}>
        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
        <circle cx="12" cy="12" r="3" />
      </g>
      <path className="pw-slash" d={slash} pathLength="1" />
    </svg>
  );
}

/** Helper or error copy. The row opens its height first, then the words settle in; the last words stay while it closes. */
function Message(props: {
  readonly id: string;
  readonly text: string | undefined;
  readonly tone: "hint" | "error";
}) {
  const [last, setLast] = useState(props.text ?? "");
  if (props.text !== undefined && props.text !== last) setLast(props.text);
  const open = props.text !== undefined && props.text !== "";
  return (
    <span className="pw-slot" data-open={open || undefined} aria-hidden={open ? undefined : true}>
      <span className="pw-slot-inner">
        <span
          key={last}
          id={props.id}
          className={cx("pw-message", props.tone === "error" && "pw-error")}
        >
          {last}
        </span>
      </span>
    </span>
  );
}

/** The sideways shake of a refused field. Skipped when the person asks for less motion. */
function useShake(error: string | undefined) {
  const shell = useRef<HTMLDivElement>(null);
  const previous = useRef(error);
  useEffect(() => {
    const before = previous.current;
    previous.current = error;
    if (error === undefined || error === "" || error === before) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    shell.current?.animate(
      [
        { translate: "0" },
        { translate: "-6px" },
        { translate: "5px" },
        { translate: "-3px" },
        { translate: "1px" },
        { translate: "0" },
      ],
      { duration: 360, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [error]);
  return shell;
}

export interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  readonly label: string;
  /** Helper copy under the field. */
  readonly description?: string | undefined;
  /** Error copy tied to the field. It sets `aria-invalid` and shakes the field once per new error. */
  readonly error?: string | undefined;
  /** Content under the messages, for example the strength meter. */
  readonly children?: ReactNode;
}

/**
 * A password input with a show and hide button inside it. Use `autoComplete` `current-password` to sign in and
 * `new-password` to create one. The button keeps its name "Show password" and reports its state with `aria-pressed`.
 */
export function PasswordField({
  label,
  description,
  error,
  children,
  id,
  className,
  ...input
}: PasswordFieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const [shown, setShown] = useState(false);
  // The first toggle starts the resolve; before it, the value does not animate on mount.
  const [toggled, setToggled] = useState(false);
  const shell = useShake(error);
  const describedBy =
    [
      input["aria-describedby"],
      error === undefined || error === "" ? undefined : `${controlId}-error`,
      description === undefined ? undefined : `${controlId}-hint`,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="field pw">
      <label htmlFor={controlId}>{label}</label>
      <div ref={shell} className="pw-shell" data-invalid={error ? true : undefined}>
        <input
          {...input}
          id={controlId}
          type={shown ? "text" : "password"}
          className={cx("pw-input", className)}
          aria-invalid={error ? true : input["aria-invalid"]}
          aria-describedby={describedBy}
          data-reveal={toggled ? (shown ? "shown" : "hidden") : undefined}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="pw-toggle"
          aria-label="Show password"
          aria-pressed={shown}
          aria-controls={controlId}
          onClick={() => {
            setShown((current) => !current);
            setToggled(true);
          }}
        >
          <EyeMorph />
        </button>
      </div>
      <Message id={`${controlId}-error`} text={error} tone="error" />
      <Message id={`${controlId}-hint`} text={description} tone="hint" />
      {children}
    </div>
  );
}
