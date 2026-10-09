import type { PathDefaults } from "@headroom/core";

/** What the command line asks for. Flags override the environment; none are required. */
type Command =
  | { kind: "start"; port?: number; host?: string; open: boolean }
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "paths" }
  | { kind: "service"; action: "install" | "uninstall" | "status" }
  | { kind: "update"; check: boolean };

export type Parsed = { ok: true; command: Command } | { ok: false; error: string };

const serviceActions = ["install", "uninstall", "status"] as const;

/** Parse `argv` without the executable and script. Dependency-free on purpose. */
export function parseArgs(args: readonly string[]): Parsed {
  const rest = [...args];
  if (rest.includes("--version")) return { ok: true, command: { kind: "version" } };
  if (rest.includes("--help") || rest.includes("-h"))
    return { ok: true, command: { kind: "help" } };

  const first = rest[0];
  if (first === "paths") {
    return rest.length === 1
      ? { ok: true, command: { kind: "paths" } }
      : { ok: false, error: `unexpected argument: ${rest[1]}` };
  }
  if (first === "update") {
    const extra = rest.slice(1).filter((a) => a !== "--check");
    return extra.length === 0
      ? { ok: true, command: { kind: "update", check: rest.includes("--check") } }
      : { ok: false, error: `unexpected argument: ${extra[0]}` };
  }
  if (first === "service") {
    const action = serviceActions.find((a) => a === rest[1]);
    if (!action) return { ok: false, error: "service needs install, uninstall or status" };
    return rest.length === 2
      ? { ok: true, command: { kind: "service", action } }
      : { ok: false, error: `unexpected argument: ${rest[2]}` };
  }
  if (first === "start") rest.shift();

  let port: number | undefined;
  let host: string | undefined;
  let open = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--open") {
      open = true;
    } else if (arg === "--port") {
      const value = rest[++i];
      const n = Number(value);
      if (value === undefined || !Number.isInteger(n) || n < 1 || n > 65535) {
        return { ok: false, error: "--port needs a number from 1 to 65535" };
      }
      port = n;
    } else if (arg === "--host") {
      const value = rest[++i];
      if (!value) return { ok: false, error: "--host needs a value" };
      host = value;
    } else {
      return { ok: false, error: `unknown command or flag: ${arg}` };
    }
  }
  return {
    ok: true,
    command: {
      kind: "start",
      open,
      ...(port !== undefined ? { port } : {}),
      ...(host !== undefined ? { host } : {}),
    },
  };
}

export function pathsText(paths: PathDefaults): string {
  return `data:   ${paths.dataDir}\nkey:    ${paths.masterKeyFile}\nsecret: ${paths.authSecretFile}\n`;
}

export function usageText(paths: PathDefaults): string {
  const files = pathsText(paths)
    .trimEnd()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return `Usage: headroom [command] [flags]

Commands:
  start                  Run the server (default)
  paths                  Print where data and keys live
  service install        Run Headroom at login for this user
  service uninstall      Remove the login service
  service status         Report whether the service is installed and running
  update                 Install the newest release (--check only reports)

Flags:
  --port <n>             Listen port (overrides HEADROOM_PORT)
  --host <h>             Listen address (overrides HEADROOM_HOST)
  --open                 Open the dashboard in the default browser once listening
  --version              Print the version
  --help                 Print this help

Files on this machine (back up the key with the data):
${files}
`;
}

/** Open a URL in the default browser. Failures are ignored: the URL is also logged. */
export function openBrowser(url: string, platform: string = process.platform): void {
  try {
    const opener = platform === "darwin" ? "open" : "xdg-open";
    Bun.spawn([opener, url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
  } catch {
    // No opener installed; the logged URL is enough.
  }
}
