import type { MeterWindow } from "../../lib/accounts.ts";
import { When } from "../../lib/when.tsx";

/** The word that marks the window an account is limited by. The same word everywhere. */
export function LimitTag() {
  return <span className="cmp-tag">Limiting</span>;
}

/** When a window resets, or why it has no time. */
export function ResetLine(props: {
  readonly window: Pick<MeterWindow, "unlimited" | "notStarted" | "end" | "kind">;
}) {
  const { window } = props;
  if (window.unlimited) return <>No limit on this account</>;
  if (window.notStarted) return <>Nothing running yet</>;
  if (window.end === null) return <>No reset time</>;
  return (
    <When at={window.end} kind="until" prefix={window.kind === "cycle" ? "Cycle ends" : "Resets"} />
  );
}
