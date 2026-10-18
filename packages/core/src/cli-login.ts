import {
  type ClassifiedError,
  type ConnectProgress,
  classified,
  classifyUnknown,
} from "./connector.ts";
import type { StoredCredential } from "./credentials.ts";
import type { LoginRunner } from "./cli-runner.ts";

export interface FinishCliLoginOptions {
  /** Turn the credentials file the CLI wrote into a stored credential. May throw a ConnectorError. */
  readonly parse: (contents: string) => StoredCredential;
  /** Interval the application waits before the next poll while the CLI still runs. */
  readonly pollAfterMs: number;
  /** Message for a CLI that ended on its own timeout; each provider words this differently. */
  readonly expiredMessage: string;
}

/**
 * One poll of a CLI sign-in: credentials file present, process gone, timed out, ended without
 * credentials, or still running. Every terminal branch removes the attempt directory.
 */
export async function finishCliLogin(
  runner: LoginRunner,
  attemptId: string,
  options: FinishCliLoginOptions,
): Promise<ConnectProgress> {
  const status = runner.status(attemptId);
  if (!status)
    return {
      status: "error",
      error: classified("approval_expired", "the sign-in process is gone"),
    };
  if (status.credentialsPresent) {
    const contents = runner.readCredentials(attemptId);
    await runner.cleanup(attemptId);
    if (!contents)
      return { status: "error", error: classified("internal_error", "credentials file vanished") };
    try {
      return { status: "credentials", credential: options.parse(contents) };
    } catch (error) {
      return { status: "error", error: classifyUnknown(error) };
    }
  }
  if (status.state === "timed_out") {
    await runner.cleanup(attemptId);
    return { status: "error", error: classified("approval_expired", options.expiredMessage) };
  }
  if (status.state !== "running") {
    await runner.cleanup(attemptId);
    return {
      status: "error",
      error: classified("approval_denied", "the sign-in did not complete"),
    };
  }
  return { status: "waiting", privateState: { attemptId }, pollAfterMs: options.pollAfterMs };
}

export interface AwaitCliStepOptions<T> {
  /** Return the step once the output holds it, else null. */
  readonly parse: (output: string) => T | null;
  readonly now: () => number;
  /** How long the CLI gets to print its first step. */
  readonly timeoutMs: number;
  /** Error message when no step arrives, such as "codex did not print a device code". */
  readonly missing: string;
  /** Pause between status reads; the default suits a real child process. */
  readonly pollMs?: number;
}

export type CliStep<T> = { readonly step: T } | { readonly error: ClassifiedError };

/**
 * Wait for a just-started CLI to print its first step (device code or authorization URL). Returns
 * an error, after removing the attempt, when the deadline passes or the CLI stops running first.
 * A CLI that stops first failed on this machine, so the error carries its last output line.
 */
export async function awaitCliStep<T>(
  runner: LoginRunner,
  attemptId: string,
  options: AwaitCliStepOptions<T>,
): Promise<CliStep<T>> {
  const deadline = options.now() + options.timeoutMs;
  let status = runner.status(attemptId);
  let step = options.parse(status?.output ?? "");
  while (!step && options.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- waiting on a child process's first lines
    await Bun.sleep(options.pollMs ?? 100);
    status = runner.status(attemptId);
    if (!status || status.state !== "running") break;
    step = options.parse(status.output);
  }
  if (step) return { step };
  await runner.cleanup(attemptId);
  if (status?.state === "running")
    return { error: classified("provider_unavailable", options.missing) };
  const last = lastLine(status?.output ?? "");
  return {
    error: classified(
      "internal_error",
      `${options.missing}; the CLI exited${last ? `: ${last}` : ""}`,
    ),
  };
}

function lastLine(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? "").slice(0, 200);
}
