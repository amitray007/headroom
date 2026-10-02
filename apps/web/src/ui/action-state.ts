/** The four faces of an action button: waiting for a press, running, finished, or failed. */
export type ActionPhase = "idle" | "pending" | "success" | "failed";

/**
 * Run `action` and report each phase through `set`. A rejected action is the failed phase; the error is not
 * rethrown, because the button shows the failure in place. Resolves with the final phase.
 */
export async function runAction(
  action: () => Promise<void>,
  set: (phase: ActionPhase) => void,
): Promise<"success" | "failed"> {
  set("pending");
  try {
    await action();
  } catch {
    set("failed");
    return "failed";
  }
  set("success");
  return "success";
}

/** The three faces of a copy button. */
export type CopyPhase = "idle" | "copied" | "error";

/** Write `text` to the clipboard through `write`. A refused write is `error`, never a throw. */
export async function copyText(
  text: string,
  write: (text: string) => Promise<void>,
): Promise<"copied" | "error"> {
  try {
    await write(text);
    return "copied";
  } catch {
    return "error";
  }
}
