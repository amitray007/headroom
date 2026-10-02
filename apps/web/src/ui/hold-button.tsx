import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { CheckIcon, ResetIcon } from "../icons.tsx";
import { cx } from "./cx.ts";
import { prefersReducedMotion } from "./motion.ts";
import { Spinner } from "./spinner.tsx";
import { Swap } from "./swap.tsx";

const holdMs = 1200;

export type HoldPhase = "idle" | "holding" | "requesting" | "ok" | "failed";

/**
 * A button that acts only after the pointer, Space or Enter is held for 1.2 seconds, so a stray click cannot
 * run a mutating account action. Releasing early rewinds the fill. `onConfirm` runs once the hold completes
 * and reports whether the provider accepted it. `off` shows the dashed, disabled look with an explanation.
 */
export function HoldButton(props: {
  /** Idle label, for example "Hold to Reset Weekly Limit". */
  readonly label: string;
  readonly onConfirm: () => Promise<"ok" | "failed">;
  readonly requestingLabel?: string;
  readonly okLabel?: string;
  readonly failedLabel?: string;
  readonly icon?: ReactNode;
  readonly size?: "md" | "sm";
  readonly disabled?: boolean;
  /** The action is switched off in settings. */
  readonly off?: boolean;
  readonly offTitle?: string;
  /** Show a fixed state with a fixed progress, for the component gallery. */
  readonly preview?: { readonly phase: HoldPhase; readonly progress?: number | undefined };
}) {
  const {
    label,
    onConfirm,
    requestingLabel = "Resetting",
    okLabel = "Weekly Limit Reset",
    failedLabel = "Reset Failed · Hold to Try Again",
    icon = <ResetIcon />,
    size = "md",
    disabled = false,
    off = false,
    offTitle = "Account actions are switched off in Settings.",
    preview,
  } = props;
  const hintId = useId();
  const [live, setLive] = useState<{ phase: HoldPhase; rewind: boolean }>({
    phase: "idle",
    rewind: false,
  });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const phaseRef = useRef<HoldPhase>("idle");
  const confirmRef = useRef(onConfirm);
  useEffect(() => {
    confirmRef.current = onConfirm;
  }, [onConfirm]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const phase = preview?.phase ?? live.phase;
  const set = (next: HoldPhase, rewind = false): void => {
    phaseRef.current = next;
    setLive({ phase: next, rewind });
  };
  const blocked = off || disabled || preview !== undefined;

  const complete = async (): Promise<void> => {
    set("requesting");
    let outcome: "ok" | "failed";
    try {
      outcome = await confirmRef.current();
    } catch {
      outcome = "failed";
    }
    set(outcome);
  };
  const start = (): void => {
    if (blocked || (phaseRef.current !== "idle" && phaseRef.current !== "failed")) return;
    set("holding");
    timer.current = setTimeout(() => void complete(), prefersReducedMotion() ? 0 : holdMs);
  };
  const cancel = (): void => {
    if (phaseRef.current !== "holding") return;
    clearTimeout(timer.current);
    set("idle", true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
      event.preventDefault();
      start();
    }
  };

  const text =
    phase === "requesting"
      ? requestingLabel
      : phase === "ok"
        ? okLabel
        : phase === "failed"
          ? failedLabel
          : label;
  const face =
    phase === "requesting" ? <Spinner /> : phase === "ok" ? <CheckIcon className="check" /> : icon;
  const isOff = off && preview === undefined;
  const style: CSSProperties & Record<string, string> = {};
  if (preview?.progress !== undefined) style["--p"] = `${preview.progress}%`;

  return (
    <>
      <button
        type="button"
        className={cx(
          "btn",
          "hold",
          size === "sm" && "sm",
          phase === "holding" && "holding",
          live.rewind && preview === undefined && "rewind",
          (phase === "requesting" || phase === "ok") && "done",
          phase === "ok" && "good",
          phase === "failed" && "failed",
          isOff && "off",
        )}
        style={style}
        disabled={isOff || disabled || phase === "requesting" || phase === "ok"}
        title={isOff ? offTitle : undefined}
        aria-describedby={hintId}
        onPointerDown={(event) => {
          if (event.button === 0) start();
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") cancel();
        }}
        onBlur={cancel}
        onContextMenu={(event) => event.preventDefault()}
      >
        <Swap swapKey={phase === "holding" ? "idle" : phase} contentClassName="face">
          {face}
          <span className="label">{text}</span>
        </Swap>
        <span className="fillface" aria-hidden="true">
          {face}
          {text}
        </span>
      </button>
      <span id={hintId} className="sr">
        Press and hold for 1.2 seconds to confirm. With a keyboard, hold Space or Enter.
      </span>
    </>
  );
}
