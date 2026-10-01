import type { AttemptState, ConnectionState, NextStepPayload } from "@headroom/core/contracts";

const connectionStateLabels: Record<ConnectionState, string> = {
  ready: "Ready",
  partial: "Partial data",
  reconnect_required: "Reconnect required",
  paused: "Paused",
};

export function connectionStateLabel(state: ConnectionState): string {
  return connectionStateLabels[state];
}

const attemptStateLabels: Record<AttemptState, string> = {
  created: "Starting",
  awaiting_user: "Waiting for you",
  awaiting_input: "Waiting for your input",
  validating: "Checking",
  succeeded: "Connected",
  failed: "Failed",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function attemptStateLabel(state: AttemptState): string {
  return attemptStateLabels[state];
}

/** Attempt states after which nothing more can happen. */
export function isTerminal(state: AttemptState): boolean {
  return (
    state === "succeeded" || state === "failed" || state === "expired" || state === "cancelled"
  );
}

/** Only the awaiting_user state is polled; awaiting_input waits for a form submit. */
export function shouldPoll(state: AttemptState): boolean {
  return state === "awaiting_user" || state === "validating" || state === "created";
}

export type StepForm = "none" | "redirect" | "code" | "selection" | "api_key" | "file";

/** Which input form a step needs; link-only steps need none. */
export function stepForm(step: NextStepPayload): StepForm {
  switch (step.kind) {
    case "open_url":
    case "device_code":
      return "none";
    case "paste_redirect":
      return step.accepts === "code" ? "code" : "redirect";
    case "select_account":
      return "selection";
    case "api_key":
      return "api_key";
    case "paste_file":
      return "file";
  }
}

const acceptsLabels = {
  url: "Paste the full URL you were sent to",
  code: "Paste the code shown",
  url_or_code: "Paste the URL or the code",
} as const;

export function acceptsLabel(accepts: keyof typeof acceptsLabels): string {
  return acceptsLabels[accepts];
}

const methodLabels: Record<string, string> = {
  cli_login: "Command-line login",
  device_code: "Device code",
  paste_redirect: "Paste redirect",
  approval_poll: "Approve in provider",
  api_key: "API key",
  import: "Import from file",
};

export function methodLabel(method: string): string {
  return methodLabels[method] ?? method;
}

/** Choose the submit kind for a pasted value; "url_or_code" decides by shape. */
export function pasteInputKind(
  accepts: "url" | "code" | "url_or_code",
  value: string,
): "redirect" | "code" {
  if (accepts === "url") return "redirect";
  if (accepts === "code") return "code";
  return /^https?:\/\//i.test(value.trim()) ? "redirect" : "code";
}
