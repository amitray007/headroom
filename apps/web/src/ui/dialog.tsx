import { useEffect, useId, useRef, type ReactNode } from "react";

import { CloseIcon } from "../icons.tsx";
import { Button } from "./button.tsx";
import { cx } from "./cx.ts";

/**
 * A modal dialog on the native <dialog> element. It closes on Escape, on a press of the backdrop and on the
 * close button, then calls `onClose`; the browser returns focus to the control that opened it. The body
 * scrolls when the dialog is taller than the window.
 */
export function Dialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  /** "settings" is the wider dialog with rows. */
  readonly variant?: "default" | "settings";
  readonly children: ReactNode;
}) {
  const { open, onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    const onBackdrop = (event: MouseEvent): void => {
      if (event.target === dialog) dialog.close();
    };
    const onNativeClose = (): void => onClose();
    dialog.addEventListener("click", onBackdrop);
    dialog.addEventListener("close", onNativeClose);
    return () => {
      dialog.removeEventListener("click", onBackdrop);
      dialog.removeEventListener("close", onNativeClose);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={cx("dlg", props.variant === "settings" && "settings")}
      aria-labelledby={titleId}
    >
      <div className="dhead">
        <h2 id={titleId}>{props.title}</h2>
        <Button variant="quiet" size="sm" aria-label="Close" onClick={() => ref.current?.close()}>
          <CloseIcon />
        </Button>
      </div>
      <div className="dbody">{props.children}</div>
    </dialog>
  );
}
