import type { Context } from "hono";

import {
  ActionNotAllowedError,
  ActionNotConfirmedError,
  ActionsDisabledError,
  InvalidAttemptStateError,
  ProviderDisabledError,
  UnsupportedActionError,
  UnsupportedMethodError,
} from "@headroom/core";

/** Map service errors to responses without leaking internals. Unknown errors rethrow to onError. */
export function handleServiceError(c: Context, error: unknown): Response {
  if (error instanceof ProviderDisabledError)
    return c.json({ error: "provider_disabled", provider: error.provider }, 404);
  if (error instanceof UnsupportedMethodError) {
    return c.json(
      { error: "unsupported_method", provider: error.provider, method: error.method },
      400,
    );
  }
  if (error instanceof InvalidAttemptStateError)
    return c.json({ error: "invalid_attempt_state", state: error.state }, 409);
  if (error instanceof ActionsDisabledError) return c.json({ error: "actions_disabled" }, 403);
  if (error instanceof ActionNotConfirmedError) return c.json({ error: "not_confirmed" }, 400);
  if (error instanceof UnsupportedActionError)
    return c.json({ error: "unsupported_action", action: error.action }, 400);
  if (error instanceof ActionNotAllowedError)
    return c.json({ error: "action_not_allowed", reason: error.reason }, 409);
  if (error instanceof Error && /not found/.test(error.message))
    return c.json({ error: "not_found" }, 404);
  throw error;
}
