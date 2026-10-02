import type { Cell } from "./present.ts";
import { When } from "./when.tsx";

type ResetWords = Extract<Cell, { kind: "meter" }>["resetWords"];

/** The verb that leads a reset line: a billing cycle ends, a rolling window resets. */
export function resetVerb(words: ResetWords): "Resets" | "Cycle ends" {
  return words === "resets" || words === "not_started" ? "Resets" : "Cycle ends";
}

/**
 * The reset of one meter in words: "Resets in 2 h", "Cycle ends in 12 days", "Resets with the cycle" for a pool
 * that follows the billing cycle, "Not Started" for a session that has not opened, or "No reset time".
 */
export function ResetCaption(props: {
  readonly resetWords: ResetWords;
  readonly resetsAt: number | null;
}) {
  const { resetWords, resetsAt } = props;
  if (resetWords === "with_cycle") return "Resets with the cycle";
  if (resetWords === "not_started") return "Not Started";
  if (resetsAt === null) return "No reset time";
  return <When at={resetsAt} kind="until" prefix={resetVerb(resetWords)} />;
}
