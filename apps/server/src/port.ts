import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";

import { DEFAULT_PORT } from "@headroom/core";

/** The default before D49. An install that already has data keeps its URL. */
export const LEGACY_PORT = 8080;
/** How many ports from DEFAULT_PORT the search tries: 4323 to 4342. */
const SEARCH_COUNT = 20;
const LAST_PORT = DEFAULT_PORT + SEARCH_COUNT - 1;

const portFile = (dataDir: string): string => join(dataDir, "port");

export interface PortEvidence {
  /** HEADROOM_PORT or --port. Strict: no other port is tried. */
  readonly explicit?: number | undefined;
  /** The port the last run bound, from the `port` file. */
  readonly saved?: number | undefined;
  /** `headroom.db` exists, so the install is older than D49. */
  readonly hasDatabase: boolean;
}

/** The ports to try, in order. */
export function portCandidates(evidence: PortEvidence): number[] {
  if (evidence.explicit !== undefined) return [evidence.explicit];
  const first = evidence.saved ?? (evidence.hasDatabase ? LEGACY_PORT : undefined);
  const range = Array.from({ length: SEARCH_COUNT }, (_, i) => DEFAULT_PORT + i);
  return [...new Set(first === undefined ? range : [first, ...range])];
}

function readSavedPort(dataDir: string): number | undefined {
  try {
    const value = Number(readFileSync(portFile(dataDir), "utf8").trim());
    return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Read the files that decide the order. Call before bootstrap creates the database. */
export function resolveCandidates(dataDir: string, explicit: number | undefined): number[] {
  return portCandidates({
    explicit,
    saved: readSavedPort(dataDir),
    hasDatabase: existsSync(join(dataDir, "headroom.db")),
  });
}

/** Remember the bound port for the next start. A failure is reported, not fatal. */
export function savePort(dataDir: string, port: number): Error | undefined {
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(portFile(dataDir), `${port}\n`);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

function accepts(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const done = (taken: boolean) => {
      socket.destroy();
      resolve(taken);
    };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Whether something already listens on the port. A bind alone is not enough: on macOS a bind to
 * 127.0.0.1 succeeds beside a listener on another address family, and then shadows it.
 */
async function portInUse(port: number, host: string): Promise<boolean> {
  const targets = [...new Set([host, "127.0.0.1", "::1"])];
  return (await Promise.all(targets.map((target) => accepts(port, target)))).some(Boolean);
}

/**
 * Listen on the first free candidate. The 503 handler holds the port while the app starts: the
 * base URL needs the bound port, and the app needs the base URL. A single candidate is the
 * owner's explicit choice and gets no pre-check, so a busy port fails as the bind reports it.
 */
export async function bindFirstFree(
  candidates: readonly number[],
  hostname: string,
  inUse: (port: number, host: string) => Promise<boolean> = portInUse,
) {
  const strict = candidates.length === 1;
  const taken = strict
    ? []
    : await Promise.all(candidates.map((candidate) => inUse(candidate, hostname)));
  for (const [index, port] of candidates.entries()) {
    if (taken[index]) continue;
    try {
      const server = Bun.serve({
        port,
        hostname,
        // Production behaviour everywhere: no Bun error pages with stack traces.
        development: false,
        fetch: () => new Response("Headroom is starting", { status: 503 }),
      });
      return { server, port };
    } catch (error) {
      if (strict || !isAddressInUse(error)) throw error;
    }
  }
  throw new Error(
    `no free port from ${DEFAULT_PORT} to ${LAST_PORT}; free one or set HEADROOM_PORT to use another`,
  );
}
