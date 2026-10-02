import {
  isValidElement,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

import { cx } from "./cx.ts";
import { Fade } from "./fade.tsx";
import { Spinner } from "./spinner.tsx";

export type ButtonVariant = "default" | "primary" | "quiet" | "danger" | "quiet-danger";

/** Class names for a button face. Shared by the button family: button, action, split and copy buttons. */
export function buttonClass(variant: ButtonVariant, size: "md" | "sm", extra?: string): string {
  return cx(
    "btn",
    variant === "primary" && "primary",
    (variant === "quiet" || variant === "quiet-danger") && "quiet",
    (variant === "danger" || variant === "quiet-danger") && "danger",
    size === "sm" && "sm",
    extra,
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children"> & {
  readonly variant?: ButtonVariant;
  readonly size?: "md" | "sm";
  /** Leading icon, drawn before the label. */
  readonly icon?: ReactNode;
  /**
   * While busy the button shows a spinner, its label fades to `busyLabel`, and presses are ignored. It stays
   * focusable (aria-disabled), so keyboard focus survives the action.
   */
  readonly busy?: boolean;
  readonly busyLabel?: string;
  readonly className?: string;
  readonly children: ReactNode;
};

/** The one button. Press scale, hover, focus and disabled states come from buttons.css. */
export function Button(props: ButtonProps) {
  const {
    variant = "default",
    size = "md",
    icon,
    busy = false,
    busyLabel,
    className,
    children,
    type = "button",
    disabled,
    onClick,
    ...rest
  } = props;
  const label = busy && busyLabel !== undefined ? busyLabel : children;
  const labelKey = busy ? "busy" : typeof children === "string" ? `label:${children}` : "label";
  // An icon with no text presses a little deeper, so every size reads as the same push.
  const iconOnly = icon === undefined && isValidElement(children);
  const swallow = (event: MouseEvent<HTMLButtonElement>): void => {
    if (busy) event.preventDefault();
    else onClick?.(event);
  };
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass(variant, size, cx(iconOnly && "icon-only", className))}
      disabled={disabled === true}
      aria-disabled={busy ? "true" : undefined}
      aria-busy={busy ? "true" : undefined}
      onClick={swallow}
    >
      <Fade swapKey={labelKey} className="label">
        {busy ? <Spinner /> : icon}
        {label}
      </Fade>
    </button>
  );
}

type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "children"> & {
  readonly variant?: "default" | "primary" | "quiet";
  readonly size?: "md" | "sm";
  readonly icon?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
};

/** A link that looks like a button, for navigation such as "Connect an Account". */
export function ButtonLink(props: ButtonLinkProps) {
  const { variant = "default", size = "md", icon, className, children, ...rest } = props;
  return (
    <a {...rest} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </a>
  );
}
