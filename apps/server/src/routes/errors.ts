import type { Context } from "hono";

import {
  InvalidAttemptStateError,
  ProviderDisabledError,
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
  if (error instanceof Error && /not found/.test(error.message))
    return c.json({ error: "not_found" }, 404);
  throw error;
}
