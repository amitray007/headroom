/** Small parsers every connector needs. They never throw; a value they cannot read is `null`. */

/** The payload of a JWT, or null when the token is not a decodable JWT. The signature is not checked. */
export function decodeJwt(token: string): unknown {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
  } catch {
    return null;
  }
}

/** The `exp` claim of a JWT in epoch milliseconds, or null when the token carries none. */
export function expiryOf(token: string): number | null {
  const claims = decodeJwt(token);
  if (typeof claims !== "object" || claims === null || !("exp" in claims)) return null;
  return typeof claims.exp === "number" && Number.isFinite(claims.exp) ? claims.exp * 1000 : null;
}

/** An ISO date string in epoch milliseconds, or null when it is absent or unreadable. */
export function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
