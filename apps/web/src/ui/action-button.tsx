import { useEffect, useRef, useState, type ReactNode } from "react";

import { AlertIcon } from "../icons.tsx";
import { runAction, type ActionPhase } from "./action-state.ts";
import { DrawnCheck } from "./drawn-check.tsx";
import { buttonClass, type ButtonVariant } from "./button.tsx";
import { Spinner } from "./spinner.tsx";
import { Swap } from "./swap.tsx";

/**
 * An async action that shows pending, success and failure on the button itself. The label cell reserves the
 * widest of its four labels, so no phase moves the layout. Pending keeps focus (aria-disabled, not disabled)
 * and ignores presses. After a result the button returns to idle by itself.
 */
export function ActionButton(props: {
  readonly label: string;
  readonly pendingLabel: string;
  readonly successLabel: string;
  readonly failedLabel: string;
  /** Idle icon. Pending, success and failure swap in a spinner, a drawn tick and an alert. */
  readonly icon: ReactNode;
  readonly onAction: () => Promise<void>;
  readonly variant?: ButtonVariant;
  readonly size?: "md" | "sm";
  readonly disabled?: boolean;
  readonly resetAfterMs?: number;
}) {
  const {
    label,
    pendingLabel,
    successLabel,
    failedLabel,
    icon,
    onAction,
    variant = "default",
    size = "md",
    disabled = false,
    resetAfterMs = 1600,
  } = props;
  const [phase, setPhase] = useState<ActionPhase>("idle");
  const live = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const run = async (): Promise<void> => {
    if (phase !== "idle" || disabled) return;
    await runAction(onAction, (next) => {
      if (live.current) setPhase(next);
    });
    if (!live.current) return;
    timer.current = setTimeout(() => setPhase("idle"), resetAfterMs);
  };

  const text =
    phase === "pending"
      ? pendingLabel
      : phase === "success"
        ? successLabel
        : phase === "failed"
          ? failedLabel
          : label;
  const face =
    phase === "pending" ? (
      <Spinner />
    ) : phase === "success" ? (
      <DrawnCheck />
    ) : phase === "failed" ? (
      <AlertIcon />
    ) : (
      icon
    );
  const status = phase === "pending" || phase === "idle" ? "" : text;

  return (
    <button
      type="button"
      className={buttonClass(variant, size, `action ${phase}`)}
      disabled={disabled}
      aria-disabled={phase === "pending" ? true : undefined}
      aria-busy={phase === "pending" ? true : undefined}
      data-phase={phase}
      onClick={() => void run()}
    >
      <span className="face-slot">
        <Swap swapKey={`face-${phase}`} contentClassName="morph-face">
          {face}
        </Swap>
      </span>
      <span className="text-cell">
        {[label, pendingLabel, successLabel, failedLabel].map((entry) => (
          <span key={entry} className="measure" aria-hidden="true">
            {entry}
          </span>
        ))}
        <Swap swapKey={`text-${phase}`} contentClassName="morph-text">
          {text}
        </Swap>
      </span>
      <output className="sr">{status}</output>
    </button>
  );
}
