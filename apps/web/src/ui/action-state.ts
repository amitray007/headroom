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

/**
 * How the reset button reads an action outcome. Only `succeeded` and `failed` are certain. Anything else
 * (`uncertain`, or an action still `requested` or `submitted`) means the provider may have consumed the
 * reset, so the button must not offer a retry, which would use a new idempotency key.
 */
export function resetOutcome(state: string): "ok" | "failed" | "unknown" {
  if (state === "succeeded") return "ok";
  if (state === "failed") return "failed";
  return "unknown";
}

/**
 * The same, when the request itself threw. A 4xx answer means the server refused before calling the
 * provider; a network error or a 5xx may hide a request that got through.
 */
export function resetOutcomeOfError(status: number | null): "failed" | "unknown" {
  return status !== null && status >= 400 && status < 500 ? "failed" : "unknown";
}
