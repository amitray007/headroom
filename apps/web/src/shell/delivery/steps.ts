import type { StepState } from "../../ui/stepper.tsx";

export const telegramWords = ["Bot", "Chat", "Test", "Done"] as const;
export const webhookWords = ["URL", "Secret", "Test", "Done"] as const;

export type Stage = "first" | "second" | "test" | "done";
const order: readonly Stage[] = ["first", "second", "test", "done"];

/** Where the stepper stands for a stage. A failed test marks its own step; the last step reads as done. */
export function stepperAt(
  stage: Stage,
  failed: boolean,
): { readonly step: number; readonly state: StepState } {
  const step = order.indexOf(stage) + 1;
  if (stage === "done") return { step, state: "done" };
  return { step, state: failed ? "failed" : "current" };
}
