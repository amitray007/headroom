import { cx } from "./cx.ts";
import "./stepper.css";

export type StepState = "current" | "failed" | "done";

/**
 * The numbered words of a guided flow. `step` is the current step, counted from 1. Earlier steps read as done;
 * the current one takes `state`.
 */
export function Stepper(props: {
  readonly words: readonly string[];
  readonly step: number;
  readonly state: StepState;
}) {
  return (
    <ol className="stepper" aria-label="Progress">
      {props.words.map((word, index) => {
        const number = index + 1;
        const look = number < props.step ? "done" : number === props.step ? props.state : undefined;
        return (
          <li
            key={word}
            className={cx(look)}
            aria-current={number === props.step && props.state === "current" ? "step" : undefined}
          >
            <span className="n">{number}</span>
            {word}
          </li>
        );
      })}
    </ol>
  );
}
