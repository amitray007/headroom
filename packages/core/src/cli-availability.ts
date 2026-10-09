import type { MethodAvailability } from "./connector.ts";
import type { AuthMethod } from "./enums.ts";

/**
 * Whether `method` can start given the official CLI a connector may need. Only `cli_login` needs
 * it. `binary` is an absolute path or a bare name looked up on PATH; `name` is the program the
 * owner would install. A directory, a file without the execute bit and an unknown name all count
 * as not installed. Cheap: one PATH lookup, no process.
 */
export function cliAvailability(
  method: AuthMethod,
  name: string,
  binary: string,
): MethodAvailability {
  if (method !== "cli_login") return { method, available: true, reason: null, cli: null };
  const found = Bun.which(binary) !== null;
  return {
    method,
    available: found,
    reason: found ? null : "cli_not_installed",
    cli: name,
  };
}
