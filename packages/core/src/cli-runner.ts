import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Runs a pinned official CLI once for sign-in. See "CLI login runner" in
 * docs/architecture/connections.md. The process lives only in memory, so an
 * attempt cannot survive a Headroom restart; the connector marks it failed.
 */

export interface CliLoginSpec {
  readonly attemptId: string;
  /** Command and arguments; argv[0] must be an absolute path or on the allowlisted PATH. */
  readonly command: readonly string[];
  /** Name of the environment variable that points the CLI at its config directory. */
  readonly homeVariable: string;
  /** Extra non-secret environment for this CLI. */
  readonly env?: Readonly<Record<string, string>>;
  /** Relative path under the attempt directory where the CLI writes its credentials file. */
  readonly credentialFile: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
}

export interface CliLoginStatus {
  readonly state: "running" | "exited" | "killed" | "timed_out";
  readonly exitCode: number | null;
  /** Redacted, ANSI-stripped output collected so far, bounded. */
  readonly output: string;
  readonly credentialsPresent: boolean;
}

interface Running {
  readonly spec: CliLoginSpec;
  readonly dir: string;
  readonly process: ReturnType<typeof Bun.spawn>;
  readonly started: number;
  output: string;
  state: CliLoginStatus["state"];
  timer: ReturnType<typeof setTimeout> | null;
}

/** What connectors depend on; CliLoginRunner implements it and tests substitute a fake. */
export interface LoginRunner {
  start(spec: CliLoginSpec): void;
  status(attemptId: string): CliLoginStatus | null;
  write(attemptId: string, line: string): void;
  readCredentials(attemptId: string): string | null;
  kill(attemptId: string): Promise<void>;
  cleanup(attemptId: string): Promise<void>;
}

export interface CliLoginRunnerOptions {
  /** Attempt directories live under here, one per attempt, mode 0700, deleted on cleanup. */
  readonly attemptsDir: string;
  /** PATH passed to the CLI. Default is the current process PATH. */
  readonly path?: string;
  readonly now?: () => number;
}

export class CliLoginRunner implements LoginRunner {
  private readonly running = new Map<string, Running>();
  private readonly now: () => number;

  constructor(private readonly options: CliLoginRunnerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  attemptDir(attemptId: string): string {
    if (!/^[A-Za-z0-9-]+$/.test(attemptId)) throw new Error("invalid attempt id");
    return resolve(join(this.options.attemptsDir, attemptId));
  }

  /** Spawn the CLI with an allowlisted environment inside a fresh attempt directory. */
  start(spec: CliLoginSpec): void {
    if (this.running.has(spec.attemptId)) throw new Error("attempt already running");
    const dir = this.attemptDir(spec.attemptId);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const shims = installShims(dir);
    const env: Record<string, string> = {
      PATH: `${shims}:${this.options.path ?? process.env["PATH"] ?? "/usr/bin:/bin"}`,
      HOME: dir,
      [spec.homeVariable]: dir,
      TERM: "dumb",
      NO_COLOR: "1",
      LANG: "C.UTF-8",
      BROWSER: join(shims, "open"),
      ...spec.env,
    };
    const child = Bun.spawn([...spec.command], {
      cwd: dir,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const entry: Running = {
      spec,
      dir,
      process: child,
      started: this.now(),
      output: "",
      state: "running",
      timer: null,
    };
    this.running.set(spec.attemptId, entry);
    const limit = spec.maxOutputBytes ?? 64 * 1024;
    const pump = async (stream: ReadableStream<Uint8Array> | null): Promise<void> => {
      if (!stream) return;
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        if (entry.output.length >= limit) continue;
        entry.output = (entry.output + stripAnsi(decoder.decode(chunk, { stream: true }))).slice(
          0,
          limit,
        );
      }
    };
    void pump(child.stdout);
    void pump(child.stderr);
    void (async () => {
      await child.exited;
      if (entry.state === "running") entry.state = "exited";
      if (entry.timer) clearTimeout(entry.timer);
    })();
    entry.timer = setTimeout(() => {
      if (entry.state === "running") {
        entry.state = "timed_out";
        child.kill();
      }
    }, spec.timeoutMs);
  }

  status(attemptId: string): CliLoginStatus | null {
    const entry = this.running.get(attemptId);
    if (!entry) return null;
    return {
      state: entry.state,
      exitCode: entry.process.exitCode,
      output: entry.output,
      credentialsPresent: existsSync(join(entry.dir, entry.spec.credentialFile)),
    };
  }

  /** Feed one line to the CLI, for flows that ask for a pasted code. Never logged. */
  write(attemptId: string, line: string): void {
    const entry = this.running.get(attemptId);
    if (!entry || entry.state !== "running") throw new Error("attempt is not running");
    const stdin = entry.process.stdin;
    if (!stdin || typeof stdin === "number") throw new Error("stdin unavailable");
    void Promise.resolve(stdin.write(`${line}\n`))
      .then(() => stdin.flush())
      .catch(() => undefined);
  }

  /** Read the credentials file the CLI wrote. Caller encrypts it and then calls cleanup. */
  readCredentials(attemptId: string): string | null {
    const entry = this.running.get(attemptId);
    if (!entry) return null;
    const path = join(entry.dir, entry.spec.credentialFile);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  async kill(attemptId: string): Promise<void> {
    const entry = this.running.get(attemptId);
    if (!entry) return;
    if (entry.state === "running") {
      entry.state = "killed";
      entry.process.kill();
    }
    await entry.process.exited;
  }

  /** Kill if needed and delete the attempt directory, including any credentials file. */
  async cleanup(attemptId: string): Promise<void> {
    const entry = this.running.get(attemptId);
    if (entry) {
      await this.kill(attemptId);
      if (entry.timer) clearTimeout(entry.timer);
      this.running.delete(attemptId);
    }
    rmSync(this.attemptDir(attemptId), { recursive: true, force: true });
  }

  /** Remove every attempt directory left behind by a previous process. */
  sweep(): number {
    if (!existsSync(this.options.attemptsDir)) return 0;
    let removed = 0;
    for (const name of readdir(this.options.attemptsDir)) {
      if (this.running.has(name)) continue;
      rmSync(join(this.options.attemptsDir, name), { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }
}

/**
 * macOS `security` answers for the Claude CLI's keychain storage. With HOME redirected there is
 * no keychain, macOS shows a "Keychain Not Found" dialog and the login ends without a file.
 * Claude Code (2.1.286, source-inspected) treats exit 44 from `find-generic-password` as "no
 * item" and any other non-zero, non-timeout exit as a definitive keychain failure, after which
 * it writes `.credentials.json` (mode 0600) under its config directory instead. The shim gives
 * exactly those answers, reads any stdin to /dev/null so a token payload never reaches a
 * terminal, and logs nothing.
 */
const securityShim = `#!/bin/sh
# Headroom: CLI logins must write their credentials file, never an OS keychain.
case "$1" in
  find-generic-password|delete-generic-password) exit 44 ;;
  -i) cat >/dev/null 2>&1; exit 1 ;;
  *) exit 1 ;;
esac
`;

/**
 * Shims first on the CLI's PATH, created per attempt:
 * - `open` and `xdg-open` do nothing. A CLI that finds them opens the sign-in page in a browser
 *   on the server, with a redirect to its own loopback listener. On the owner's machine that
 *   silently succeeds outside Headroom's flow; in a container it fails. Both are wrong, so the
 *   CLI falls back to printing the URL Headroom shows the owner.
 * - `security` refuses keychain storage so the CLI writes its credentials file.
 */
function installShims(dir: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { mode: 0o700 });
  for (const name of ["open", "xdg-open"]) {
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  }
  writeFileSync(join(bin, "security"), securityShim, { mode: 0o700 });
  return bin;
}

function readdir(dir: string): string[] {
  try {
    return [...new Bun.Glob("*").scanSync({ cwd: dir, onlyFiles: false })];
  } catch {
    return [];
  }
}

// eslint-disable-next-line no-control-regex -- ANSI escape sequences are control characters by definition
const ansiPattern = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ansiPattern, "");
}
