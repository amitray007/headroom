/**
 * Write THIRD_PARTY_NOTICES.md: the copyright and license text of everything Headroom ships that it did not write.
 * Ported code and the Docker image's sign-in CLIs come from the curated lists below and the texts in LICENSES/.
 * Packages come from the installed node_modules: every runtime dependency of the workspaces, followed
 * transitively through regular dependencies. Versions are left out, so the file changes only when a package or a license changes.
 *
 *   bun scripts/notices.ts           write the file
 *   bun scripts/notices.ts --check   fail when the file is out of date (part of `mise run check`)
 */
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const repo = join(import.meta.dir, "..");
const out = join(repo, "THIRD_PARTY_NOTICES.md");

interface Ported {
  name: string;
  url: string;
  license: string;
  /** The upstream license file, copied verbatim into LICENSES/. */
  file: string;
  used: string;
}

const PORTED: Ported[] = [
  {
    name: "CLIProxyAPI",
    url: "https://github.com/router-for-me/CLIProxyAPI",
    license: "MIT",
    file: "cliproxyapi.txt",
    used: "OAuth client settings, the PKCE and paste-redirect sign-in flows, and token and quota field handling in the Antigravity, Claude and Codex connectors (`packages/connectors/*/src/endpoints.ts`, `antigravity/src/schemas.ts`).",
  },
  {
    name: "OpenUsage",
    url: "https://github.com/robinebers/openusage",
    license: "MIT",
    file: "openusage.txt",
    used: "Endpoint lists, request headers and response shapes in the Antigravity, Claude, Copilot, Cursor and Grok connectors.",
  },
  {
    name: "pi-cursor",
    url: "https://github.com/Rahularya01/pi-cursor",
    license: "MIT",
    file: "pi-cursor.txt",
    used: "The Cursor sign-in flow: PKCE, the login URL, polling and refresh (`packages/connectors/cursor/src/index.ts`).",
  },
  {
    name: "Arc",
    url: "https://github.com/kuratlielia/arc-library",
    license: "MIT",
    file: "arc.txt",
    used: "Component style values and layouts in the web app: buttons, controls, fields, tokens, the date picker, select, menu, radio cards, money input and account menu.",
  },
  {
    name: "Lucide",
    url: "https://github.com/lucide-icons/lucide",
    license: "ISC",
    file: "lucide.txt",
    used: "The webhook icon (`apps/web/src/icons.tsx`).",
  },
];

interface Pkg {
  name: string;
  license: string;
  repository: string;
  text: string | undefined;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function names(field: unknown): string[] {
  return field && typeof field === "object" ? Object.keys(field) : [];
}

/** Node's lookup: `<ancestor>/node_modules/<name>` for each ancestor of the real package directory. */
function resolve(name: string, from: string): string | undefined {
  let dir = realpathSync(from);
  for (;;) {
    if (!dir.endsWith("/node_modules")) {
      const candidate = join(dir, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function licenseOf(manifest: Record<string, unknown>): string {
  const field = manifest["license"] ?? manifest["licenses"];
  if (typeof field === "string") return field;
  if (Array.isArray(field)) return field.map((entry: { type?: string }) => entry.type).join(" OR ");
  if (field && typeof field === "object" && "type" in field) return String(field.type);
  return "UNKNOWN";
}

function repositoryOf(manifest: Record<string, unknown>, name: string): string {
  const field = manifest["repository"];
  const url = typeof field === "string" ? field : (field as { url?: string } | undefined)?.url;
  if (!url) return `https://www.npmjs.com/package/${name}`;
  return url
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^github:/, "https://github.com/")
    .replace(/^(?!https?:)([\w.-]+\/[\w.-]+)$/, "https://github.com/$1");
}

function licenseText(dir: string): string | undefined {
  const file = readdirSync(dir)
    .filter((entry) => /^(licen[cs]e|copying)([.-].*)?$/i.test(entry))
    .toSorted()[0];
  return file ? readFileSync(join(dir, file), "utf8") : undefined;
}

/** Every package reachable from the workspaces' runtime dependencies. */
function packages(): Pkg[] {
  const workspaces = (readJson(join(repo, "package.json"))["workspaces"] as string[]).flatMap(
    (pattern) => {
      const base = join(repo, pattern.replace(/\/\*$/, ""));
      return pattern.endsWith("/*")
        ? readdirSync(base)
            .toSorted()
            .map((entry) => join(base, entry))
            .filter((dir) => existsSync(join(dir, "package.json")))
        : [base];
    },
  );
  const found = new Map<string, Pkg>();
  const seen = new Set<string>();
  const queue: { name: string; from: string }[] = workspaces.flatMap((dir) =>
    names(readJson(join(dir, "package.json"))["dependencies"]).map((name) => ({
      name,
      from: dir,
    })),
  );
  while (queue.length > 0) {
    const { name, from } = queue.shift()!;
    if (name.startsWith("@headroom/")) continue;
    const dir = resolve(name, from);
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const manifest = readJson(join(dir, "package.json"));
    if (!found.has(name)) {
      found.set(name, {
        name,
        license: licenseOf(manifest),
        repository: repositoryOf(manifest, name),
        text: licenseText(dir),
      });
    }
    // Regular dependencies only: peers come from the dependent's own list, and optional ones are
    // platform builds of tools that never reach the bundle. Type packages compile away.
    for (const dep of names(manifest["dependencies"])) {
      if (!dep.startsWith("@types/") && dep !== "bun-types") queue.push({ name: dep, from: dir });
    }
  }
  return [...found.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

/** A fenced block that the docs check accepts: no trailing whitespace, no stray fences. */
function block(text: string): string {
  const body = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd().replaceAll("```", "'''"))
    .join("\n")
    .trim();
  return "```text\n" + body + "\n```";
}

function licenses(file: string): string {
  return readFileSync(join(repo, "LICENSES", file), "utf8");
}

function render(): string {
  const list = packages();
  const parts: string[] = [
    "# Third-party notices",
    "",
    "Headroom is licensed under the [MIT License](LICENSE). It also contains work from other projects, each under its own license. This file gives their copyright notices and license texts. The release archives, the npm and PyPI packages and the Docker image ship a copy of it.",
    "",
    "`mise run notices` writes this file from [LICENSES/](LICENSES/README.md) and the installed packages. `mise run check` fails when it is out of date.",
    "",
    "- [Code ported from other projects](#code-ported-from-other-projects)",
    "- [Packages in the binary and the web app](#packages-in-the-binary-and-the-web-app)",
    "- [The Bun runtime](#the-bun-runtime)",
    "- [The sign-in CLIs in the Docker image](#the-sign-in-clis-in-the-docker-image)",
    "",
    "## Code ported from other projects",
    "",
    "Headroom adapts logic and values from these projects to TypeScript and CSS.",
  ];
  for (const project of PORTED) {
    parts.push(
      "",
      `### ${project.name}`,
      "",
      `${project.url}. License: ${project.license}. Used for: ${project.used}`,
      "",
      block(licenses(project.file)),
    );
  }
  parts.push(
    "",
    "## Packages in the binary and the web app",
    "",
    `The \`headroom\` binary and the web app are built from these ${list.length} npm packages: the runtime dependencies of the workspaces, and theirs. The web app also ships the Geist and Geist Mono fonts through \`@fontsource-variable\`, under the SIL Open Font License 1.1.`,
  );
  for (const pkg of list) {
    const fallback = /^(MIT|Apache-2\.0)$/.test(pkg.license)
      ? `The package ships no license file. The ${pkg.license} text is in [LICENSES/${pkg.license}.txt](LICENSES/${pkg.license}.txt).`
      : "The package ships no license file.";
    parts.push(
      "",
      `### ${pkg.name}`,
      "",
      `${pkg.repository}. License: ${pkg.license}.`,
      "",
      pkg.text === undefined ? fallback : block(pkg.text),
    );
  }
  parts.push(
    "",
    "## The Bun runtime",
    "",
    "The `headroom` binary is built with `bun build --compile`, so it contains the Bun runtime. Bun is MIT-licensed. It statically links JavaScriptCore and WebKit, which are licensed under the LGPL 2, and other libraries under their own licenses. [LICENSES/bun.md](LICENSES/bun.md) is Bun's own list of them. Bun's patched WebKit source is at https://github.com/oven-sh/WebKit. Headroom's full source is in this repository, so you can rebuild the binary with a modified Bun: `mise run build`.",
    "",
    "## The sign-in CLIs in the Docker image",
    "",
    "The Docker image installs three official command-line tools, unmodified, for sign-in only. Each stays under its own license or terms. Headroom's MIT License does not cover them.",
    "",
    "### Codex CLI",
    "",
    "`@openai/codex` from npm, https://github.com/openai/codex. License: Apache-2.0. The text is in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt). Its NOTICE file:",
    "",
    block(licenses("codex-notice.txt")),
    "",
    "### Grok CLI",
    "",
    "The `grok` binary from https://x.ai/cli. xAI publishes its source at https://github.com/xai-org/grok-build. License: Apache-2.0, Copyright 2023-2026 SpaceXAI. The text is in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt). Its own third-party notices are at https://github.com/xai-org/grok-build/blob/main/THIRD-PARTY-NOTICES.",
    "",
    "### Claude Code",
    "",
    "`@anthropic-ai/claude-code` from npm. Claude Code is proprietary software of Anthropic PBC and is not open source. The image installs it as Anthropic publishes it, and you sign in to it with your own Claude account. Your use of it is subject to Anthropic's legal agreements: https://code.claude.com/docs/en/legal-and-compliance.",
    "",
  );
  return parts.join("\n");
}

const text = render();
if (process.argv.includes("--check")) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (current !== text) {
    console.error(
      `${relative(repo, out)} is out of date. Run \`mise run notices\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`${relative(repo, out)} is up to date.`);
} else {
  writeFileSync(out, text);
  console.log(`Wrote ${relative(repo, out)}.`);
}
