import { createHash } from "node:crypto";
import { existsSync, renameSync, rmSync, writeFileSync } from "node:fs";

import { plistPath, unitPath } from "./service.ts";

const releasesApi = "https://api.github.com/repos/amitray007/headroom/releases/latest";
const downloadBase = "https://github.com/amitray007/headroom/releases/download";

/** How this binary reached the machine. Only a standalone install updates itself. */
export type InstallKind = "homebrew" | "npm" | "python" | "docker" | "standalone";

/** Everything `headroom update` touches, injected so tests never use the network or the disk. */
export interface UpdateDeps {
  readonly version: string;
  readonly execPath: string;
  readonly platform: string;
  readonly arch: string;
  readonly home: string;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** The `headroom` file inside a `.tar.gz` archive. */
  extractBinary(archive: Uint8Array): Promise<Uint8Array>;
  /** Write a new file with mode 0755. */
  writeExecutable(path: string, bytes: Uint8Array): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
  exists(path: string): boolean;
}

export interface UpdateOutcome {
  readonly code: number;
  readonly lines: readonly string[];
}

/** Work out the install kind from the executable path. Pure; `inDocker` is whether /.dockerenv exists. */
export function detectInstall(execPath: string, inDocker: boolean): InstallKind {
  if (execPath.includes("/Cellar/") || execPath.includes("/homebrew/")) return "homebrew";
  if (execPath.includes("node_modules")) return "npm";
  if (/site-packages|\/uv\/tools\/|\/pipx\//.test(execPath)) return "python";
  if (execPath === "/usr/local/bin/headroom" && inDocker) return "docker";
  return "standalone";
}

const parts = (v: string): number[] =>
  (v.replace(/^v/, "").split("-")[0] ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);

/** Positive when `a` is newer than `b`. Compares major.minor.patch; a leading v and a suffix are ignored. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Release asset name for this machine, or undefined when no build exists for it. */
export function assetName(platform: string, arch: string): string | undefined {
  const os = platform === "darwin" ? "darwin" : platform === "linux" ? "linux" : undefined;
  const cpu = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : undefined;
  return os && cpu ? `headroom-${os}-${cpu}.tar.gz` : undefined;
}

function restartHint(deps: UpdateDeps): string[] {
  const installed =
    deps.exists(plistPath(deps.home)) || deps.exists(unitPath(deps.home))
      ? "Headroom runs as a login service here. Restart it to use the new version:"
      : "If Headroom runs as a login service, restart it to use the new version:";
  return [
    installed,
    "  macOS:  launchctl kickstart -k gui/$(id -u)/club.theblank.headroom",
    "  Linux:  systemctl --user restart headroom",
    "  or run `headroom service install` again.",
  ];
}

const guidance: Record<Exclude<InstallKind, "standalone">, string[]> = {
  homebrew: ["Installed with Homebrew. Update with:", "  brew upgrade headroom"],
  npm: [
    "Installed from npm. Update with:",
    "  npm i -g headroomhq@latest",
    "or run the newest version without installing:",
    "  npx headroomhq@latest",
  ],
  python: [
    "Installed from PyPI. Update with:",
    "  uv tool upgrade headroomhq",
    "or, if you used pipx:",
    "  pipx upgrade headroomhq",
  ],
  docker: [
    "Running in Docker. Pull the new image and recreate the container:",
    "  docker pull ghcr.io/amitray007/headroom:latest",
    "  docker compose pull && docker compose up -d   (if you use a compose file)",
  ],
};

const checksum = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Find `<digest>  <file>` for one file in a SHA256SUMS body. */
function digestFor(sums: string, file: string): string | undefined {
  for (const line of sums.split("\n")) {
    const match = /^([0-9a-f]{64}) [ *](\S+)$/.exec(line.trim());
    if (match?.[2] === file) return match[1];
  }
  return undefined;
}

async function getBytes(deps: UpdateDeps, url: string): Promise<Uint8Array> {
  const response = await deps.fetch(url);
  if (!response.ok) throw new Error(`download failed (HTTP ${response.status}): ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Run `headroom update`. With `check`, only report. Never throws; failures come back as code 1. */
export async function runUpdate(
  options: { readonly check: boolean },
  deps: UpdateDeps,
  inDocker: boolean,
): Promise<UpdateOutcome> {
  const kind = detectInstall(deps.execPath, inDocker);
  if (kind !== "standalone") return { code: 0, lines: guidance[kind] };

  try {
    const asset = assetName(deps.platform, deps.arch);
    if (!asset) {
      return { code: 1, lines: [`No build exists for ${deps.platform} ${deps.arch}.`] };
    }

    const response = await deps.fetch(releasesApi, {
      headers: { accept: "application/vnd.github+json", "user-agent": "headroom-update" },
    });
    if (!response.ok) {
      return {
        code: 1,
        lines: [`Could not read the latest release (HTTP ${response.status}).`],
      };
    }
    const body: unknown = await response.json();
    const tag =
      typeof body === "object" && body !== null && "tag_name" in body ? body.tag_name : undefined;
    if (typeof tag !== "string" || !/^v?\d+\.\d+\.\d+/.test(tag)) {
      return { code: 1, lines: ["The latest release has no usable version tag."] };
    }
    const latest = tag.replace(/^v/, "");

    if (compareVersions(latest, deps.version) <= 0) {
      return { code: 0, lines: [`headroom ${deps.version} is up to date.`] };
    }
    if (options.check) {
      return {
        code: 0,
        lines: [
          `headroom ${latest} is available (you have ${deps.version}).`,
          "Run `headroom update` to install it.",
        ],
      };
    }

    const [archive, sums] = await Promise.all([
      getBytes(deps, `${downloadBase}/v${latest}/${asset}`),
      getBytes(deps, `${downloadBase}/v${latest}/SHA256SUMS`),
    ]);
    const expected = digestFor(new TextDecoder().decode(sums), asset);
    if (!expected) return { code: 1, lines: [`SHA256SUMS has no entry for ${asset}.`] };
    if (checksum(archive) !== expected) {
      return { code: 1, lines: [`Checksum mismatch for ${asset}. Nothing was changed.`] };
    }

    const binary = await deps.extractBinary(archive);
    // Write beside the running file, then rename over it: the swap is atomic and the old process keeps running.
    const staged = `${deps.execPath}.new`;
    try {
      deps.writeExecutable(staged, binary);
      deps.rename(staged, deps.execPath);
    } catch (error) {
      deps.remove(staged);
      throw error;
    }
    return {
      code: 0,
      lines: [`Updated headroom ${deps.version} -> ${latest}.`, ...restartHint(deps)],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return {
      code: 1,
      lines: [
        `Update failed: ${message}`,
        "If the folder is not writable, re-run the installer: curl -fsSL https://headroom.theblank.club/install | sh",
      ],
    };
  }
}

/** Real dependencies for the running machine. */
export function systemUpdateDeps(version: string, home: string): UpdateDeps {
  return {
    version,
    home,
    execPath: process.execPath,
    platform: process.platform,
    arch: process.arch,
    fetch: (url, init) => fetch(url, init),
    async extractBinary(archive) {
      const child = Bun.spawn(["tar", "-xzOf", "-", "headroom"], {
        stdin: new Blob([archive]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, code] = await Promise.all([
        new Response(child.stdout).arrayBuffer(),
        child.exited,
      ]);
      if (code !== 0 || out.byteLength === 0) throw new Error("could not unpack the archive");
      return new Uint8Array(out);
    },
    writeExecutable: (path, bytes) => writeFileSync(path, bytes, { mode: 0o755 }),
    rename: (from, to) => renameSync(from, to),
    remove: (path) => rmSync(path, { force: true }),
    exists: (path) => existsSync(path),
  };
}

/** Whether this process runs in a Docker container. */
export const insideDocker = (): boolean => existsSync("/.dockerenv");
