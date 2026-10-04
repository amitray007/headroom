import { AlertIcon, CheckIcon } from "../icons.tsx";
import { cx } from "./cx.ts";
import "./result.css";

/** The outcome of a step: a tick or an alert, a title and one line. */
export function Result(props: {
  readonly ok: boolean;
  readonly title: string;
  readonly children: string;
}) {
  return (
    <div className="result">
      <span className={cx("ok", !props.ok && "bad")}>
        {props.ok ? <CheckIcon /> : <AlertIcon />}
      </span>
      <div>
        <b>{props.title}</b>
        <p className="secondary" style={{ margin: "2px 0 0" }}>
          {props.children}
        </p>
      </div>
    </div>
  );
}
