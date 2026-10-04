import "./verified-seal.css";

import { cx } from "./cx.ts";

/**
 * A scalloped seal with a check: the mark of the recommended account. `good` is the success tone with a soft fill;
 * `muted` is the outline alone. Give it a `label` when it stands alone, and it is announced and shown on hover;
 * leave `label` out when words beside it already say the same.
 */
export function VerifiedSeal(props: {
  readonly size?: "md" | "sm";
  readonly tone?: "good" | "muted";
  readonly label?: string;
}) {
  const { size = "md", tone = "good", label } = props;
  return (
    <span
      className={cx("verified-seal", size === "sm" && "sm", tone === "muted" && "muted")}
      {...(label === undefined ? {} : { role: "img", "aria-label": label, title: label })}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.78 4.78 4 4 0 0 1-6.74 0 4 4 0 0 1-4.78-4.78 4 4 0 0 1 0-6.74Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    </span>
  );
}
