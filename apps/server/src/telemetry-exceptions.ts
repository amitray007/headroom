/**
 * Error reports for PostHog error tracking (ADR 0007). A report keeps the error class, where it
 * happened and stack frames reduced to function names and source paths inside Headroom. The message
 * is never kept: it can echo a provider response or a path on the owner's machine.
 */

export type ExceptionFrame = {
  readonly function: string;
  readonly filename: string;
  readonly lineno: number;
  readonly colno: number;
  readonly in_app: boolean;
};

export type ExceptionReport = {
  readonly type: string;
  readonly where: string;
  readonly source: "server" | "web";
  readonly frames: readonly ExceptionFrame[];
};

const frameCap = 30;

/** A class name such as `TypeError`, or `Error` when it is anything else. */
export function errorType(name: unknown): string {
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) ? name : "Error";
}

/**
 * A source path cut to the part inside the Headroom tree, so no home directory, host name or URL
 * origin is kept: `apps/server/src/x.ts`, `node_modules/hono/dist/x.js`, `assets/index-ab12.js`.
 * Anything else keeps only its file name. Null when it does not look like a source file at all.
 */
function sourcePath(raw: string): string | null {
  const path = raw
    .replaceAll("\\", "/")
    .replace(/^[a-z]+:\/\/[^/]*/i, "")
    .replace(/[?#].*$/, "");
  if (path.includes("$bunfs")) return "headroom";
  const inside =
    /^.*(?:^|\/)((?:apps\/(?:server|web)|packages\/(?:core|view-model|connectors)|node_modules|assets)\/.*)$/.exec(
      path,
    )?.[1];
  if (inside !== undefined) return inside;
  const name = path.split("/").pop() ?? "";
  return /^[\w.-]+\.(?:js|mjs|cjs|ts|tsx)$/.test(name) ? name : null;
}

/** A plain identifier path, optionally after `async`, `new`, `get` or `set`. Anything else is not kept. */
const safeFunction = (name: string): string =>
  /^(?:(?:async|new|get|set) )?[\w$.<>[\]]{1,100}$/.test(name) ? name : "anonymous";

/**
 * Frames from a V8 or JavaScriptCore stack (`at fn (path:1:2)` or `fn@path:1:2`), innermost first.
 * A line that does not name a source file, such as the message line, is skipped.
 */
export function framesOf(stack: string): ExceptionFrame[] {
  const frames: ExceptionFrame[] = [];
  for (const line of stack.split("\n")) {
    const match =
      /^\s+at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line) ??
      /^([^\s@:]*)@(.+?):(\d+):(\d+)$/.exec(line);
    const filename = match ? sourcePath(match[2] ?? "") : null;
    if (!match || filename === null) continue;
    frames.push({
      function: safeFunction(match[1] || "anonymous"),
      filename,
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: !filename.startsWith("node_modules/"),
    });
    if (frames.length === frameCap) break;
  }
  return frames;
}

/** A report for a caught error. Anything that is not an Error reports as `Error` with no frames. */
export function reportOf(error: unknown, where: string, source: "server" | "web"): ExceptionReport {
  const isError = error instanceof Error;
  return {
    type: errorType(isError ? error.name : undefined),
    where,
    source,
    frames: isError && typeof error.stack === "string" ? framesOf(error.stack) : [],
  };
}

/** The `$exception` properties PostHog error tracking reads. Frames go outermost first. */
export function exceptionProperties(report: ExceptionReport): Record<string, unknown> {
  return {
    $exception_list: [
      {
        type: report.type,
        value: report.where,
        mechanism: { handled: true, synthetic: false },
        stacktrace: {
          type: "raw",
          frames: report.frames
            .toReversed()
            .map((frame) => Object.assign({}, frame, { platform: "custom", lang: "javascript" })),
        },
      },
    ],
    where: report.where,
    source: report.source,
  };
}
