import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "./cx.ts";
import { Fade } from "./fade.tsx";
import { Spinner } from "./spinner.tsx";

type ButtonVariant = "default" | "primary" | "quiet" | "danger" | "quiet-danger";

function buttonClass(variant: ButtonVariant, size: "md" | "sm", extra?: string): string {
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
  /** While busy the button is disabled, shows a spinner, and its label fades to `busyLabel`. */
  readonly busy?: boolean;
  readonly busyLabel?: string;
  readonly className?: string;
  readonly children: ReactNode;
};

/** The one button. Press scale, hover and disabled states come from the stylesheet. */
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
    ...rest
  } = props;
  const label = busy && busyLabel !== undefined ? busyLabel : children;
  const labelKey = busy ? "busy" : typeof children === "string" ? `label:${children}` : "label";
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled === true || busy}
      aria-busy={busy ? "true" : undefined}
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
  readonly children: ReactNode;
};

/** A link that looks like a button, for navigation such as "Connect an Account". */
export function ButtonLink(props: ButtonLinkProps) {
  const { variant = "default", size = "md", icon, children, ...rest } = props;
  return (
    <a {...rest} className={buttonClass(variant, size)}>
      {icon}
      {children}
    </a>
  );
}
