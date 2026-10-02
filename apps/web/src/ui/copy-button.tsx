import { useCallback, useEffect, useRef, useState } from "react";

import { AlertIcon, CopyIcon } from "../icons.tsx";
import { copyText, type CopyPhase } from "./action-state.ts";
import { buttonClass } from "./button.tsx";
import { cx } from "./cx.ts";
import { DrawnCheck } from "./drawn-check.tsx";
import { Swap } from "./swap.tsx";

const feedbackMs = 1900;

/** Clipboard state: `copy` writes the text, shows copied or error for a moment, then returns to idle. */
function useCopyFeedback(): {
  readonly phase: CopyPhase;
  readonly copy: (text: string) => Promise<void>;
} {
  const [phase, setPhase] = useState<CopyPhase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string) => {
    clearTimeout(timer.current);
    setPhase(await copyText(text, (value) => navigator.clipboard.writeText(value)));
    timer.current = setTimeout(() => setPhase("idle"), feedbackMs);
  }, []);
  return { phase, copy };
}

/**
 * Copies `value`. The icon morphs from copy to a drawn tick (or an alert when the browser refuses), and the
 * label cell reserves its widest word, so the button never changes width. `iconOnly` drops the label; the
 * label stays as the accessible name.
 */
export function CopyButton(props: {
  readonly value: string;
  readonly label: string;
  readonly size?: "md" | "sm";
  readonly iconOnly?: boolean;
}) {
  const { value, label, size = "md", iconOnly = false } = props;
  const { phase, copy } = useCopyFeedback();
  const text = phase === "copied" ? "Copied" : phase === "error" ? "Failed" : label;
  const face =
    phase === "copied" ? <DrawnCheck /> : phase === "error" ? <AlertIcon /> : <CopyIcon />;
  const status =
    phase === "idle" ? "" : phase === "error" ? `${label}: could not copy` : `${label}: copied`;
  return (
    <>
      <button
        type="button"
        className={buttonClass("default", size, cx("copy", iconOnly && "icon-only"))}
        aria-label={iconOnly ? label : undefined}
        data-phase={phase}
        onClick={() => void copy(value)}
      >
        <span className="face-slot">
          <Swap swapKey={`face-${phase}`} contentClassName="morph-face">
            {face}
          </Swap>
        </span>
        {iconOnly ? null : (
          <span className="text-cell">
            {[label, "Copied", "Failed"].map((entry) => (
              <span key={entry} className="measure" aria-hidden="true">
                {entry}
              </span>
            ))}
            <Swap swapKey={`text-${phase}`} contentClassName="morph-text">
              {text}
            </Swap>
          </span>
        )}
      </button>
      <output className="sr">{status}</output>
    </>
  );
}
