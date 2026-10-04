import type { ReactNode } from "react";

import { Button, ButtonLink } from "./button.tsx";
import { cx } from "./cx.ts";
import { Menu } from "./menu.tsx";

function Chevron() {
  return (
    <svg
      className="chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * A main action with a menu of related actions, in one pill. The main half is a button (`onClick`) or a link
 * (`href`). The chevron half opens a `Menu` in the top layer; `children` are its `MenuItem`s. The pill presses
 * in for the main action only, so the menu opens from a still anchor.
 */
export function SplitButton(props: {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly onClick?: () => void;
  readonly href?: string;
  readonly busy?: boolean;
  readonly busyLabel?: string;
  /** Accessible name of the chevron button. */
  readonly menuLabel: string;
  readonly variant?: "default" | "primary";
  readonly size?: "md" | "sm";
  readonly children: ReactNode;
}) {
  const { label, icon, onClick, href, busy, busyLabel, menuLabel, variant = "default" } = props;
  const size = props.size ?? "md";
  return (
    <span className={cx("split", variant === "primary" && "primary", size === "sm" && "sm")}>
      {href === undefined ? (
        <Button
          size={size}
          className="split-main"
          icon={icon}
          busy={busy === true}
          {...(busyLabel === undefined ? {} : { busyLabel })}
          onClick={onClick}
        >
          {label}
        </Button>
      ) : (
        <ButtonLink size={size} className="split-main" icon={icon} href={href}>
          {label}
        </ButtonLink>
      )}
      <Menu
        variant="row"
        label={menuLabel}
        trigger={<Chevron />}
        triggerClassName={cx("btn", "split-trigger", size === "sm" && "sm")}
      >
        {props.children}
      </Menu>
    </span>
  );
}
