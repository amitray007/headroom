import { crypto, loadConfig } from "@headroom/core";

import { type AppContext, bootstrap } from "./bootstrap.ts";

/** In-memory context with a throwaway key; never touches the filesystem. */
export function testContext(env: Record<string, string> = {}): AppContext {
  return bootstrap({
    config: loadConfig(env),
    databasePath: ":memory:",
    keyring: crypto.createKeyring({ 1: crypto.parseKeyHex(crypto.generateKeyHex()) }),
  });
}

/** Extract the session cookie pair from a Set-Cookie header for reuse in later requests. */
export function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}
