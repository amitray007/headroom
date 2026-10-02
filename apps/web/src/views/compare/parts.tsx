import type { MeterWindow } from "@headroom/view-model/accounts";
import { ResetCaption } from "../../lib/reset-caption.tsx";

/** The word that marks the window an account is limited by. The same word everywhere. */
export function LimitTag() {
  return <span className="cmp-tag">Limiting</span>;
}

/** When a window resets, or why it has no time. */
export function ResetLine(props: {
  readonly window: Pick<MeterWindow, "unlimited" | "notStarted" | "end" | "resetWords">;
}) {
  const { window } = props;
  if (window.unlimited) return <>No limit on this account</>;
  if (window.notStarted) return <>Nothing running yet</>;
  return <ResetCaption resetWords={window.resetWords} resetsAt={window.end} />;
}
