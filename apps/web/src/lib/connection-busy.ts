import { ApiError } from "../api.ts";

/** Disconnect waits up to 30 seconds for a running refresh, then answers 409 `connection_busy`. */
export function isConnectionBusy(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 409 && cause.code === "connection_busy";
}

export const connectionBusyMessage =
  "A refresh is running for this account. Try again in a moment.";
