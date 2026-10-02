import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { InfoIcon } from "../icons.tsx";
import { cx } from "./cx.ts";

const hoverDelay = 250;

/**
 * A small info button with a tooltip. Hover opens it after 250 ms; focus and click open it at once; leaving,
 * Escape or a press elsewhere closes it. Put a `<b>` title first in `children`, then one line per fact.
 */
export function InfoTip(props: {
  /** Accessible name of the button, for example "All reset expiry times". */
  readonly label: string;
  readonly children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPress = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target) === true) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
    };
  }, [open]);

  return (
    <span ref={root} className={cx("info", open && "open")}>
      <button
        className="infobtn"
        type="button"
        aria-label={props.label}
        aria-describedby={id}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setOpen(true), hoverDelay);
        }}
        onPointerLeave={() => {
          clearTimeout(timer.current);
          setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >
        <InfoIcon />
      </button>
      <span className="tip" id={id} role="tooltip">
        {props.children}
      </span>
    </span>
  );
}
