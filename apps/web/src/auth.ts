import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  plugins: [usernameClient(), passkeyClient()],
});

interface AuthFailure {
  readonly status?: number | undefined;
  readonly message?: string | undefined;
}

/** Plain wording for the failures the server can produce. */
export function authErrorMessage(error: AuthFailure): string {
  if (error.status === 401) return "Wrong username or password.";
  if (error.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (error.status === 403) return "An owner already exists. Sign in instead.";
  return error.message !== undefined && error.message !== "" ? error.message : "Request failed.";
}
