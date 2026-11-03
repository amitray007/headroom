// Checks that a pull request shows its change in a "Showcase" section of the description (D50).
// A visual change needs a recording or before and after images; a behaviour change needs a
// diagram, a table, a code block or an image. See CONTRIBUTING.md#showcase-your-change.
// Usage: bun scripts/pr-showcase.ts <changed-files.txt>, with GITHUB_EVENT_PATH set.
import { appendFileSync, readFileSync } from "node:fs";

export type Showcase = { kind: "none" | "behaviour" | "visual"; problems: string[] };

type PullRequest = {
  body: string | null;
  labels: string[];
  headRef: string;
  author: string;
  files: string[];
};

const test = /(^|\/)(tests?|__tests__|Tests)\/|\.test\.tsx?$|Tests?\.swift$/;
const visualPaths = [
  /^apps\/web\/src\/.*\.(tsx|css)$/,
  /^apps\/macos\/(Headroom|Widgets|Shared)\/.*\.swift$/,
];
const behaviourPaths = [
  /^apps\/server\/src\/.*\.ts$/,
  /^packages\/.*\/src\/.*\.tsx?$/,
  /^apps\/macos\/HeadroomKit\/Sources\/.*\.swift$/,
];
// Release-please and Dependabot write their own descriptions; the owner can waive the rule.
const skipLabel = "no-showcase";

// GitHub inserts an uploaded video as a bare attachment link on its own line, and an image as <img>.
const video =
  /<video\b|^\s*https:\/\/github\.com\/user-attachments\/assets\/\S+\s*$|\S+\.(mp4|mov|webm)\b/gim;
const image = /!\[[^\]]*\]\([^)\s]+[^)]*\)|<img\b[^>]*>/gi;
const fence = /^```/m;
const table = /^\s*\|.*\|\s*$\n^\s*\|[\s:|-]+\|\s*$/m;

export function classify(files: string[]): Showcase["kind"] {
  const changed = files.filter((file) => !test.test(file));
  if (changed.some((file) => visualPaths.some((path) => path.test(file)))) return "visual";
  if (changed.some((file) => behaviourPaths.some((path) => path.test(file)))) return "behaviour";
  return "none";
}

// The text under the first "Showcase" heading, without HTML comments (the template's hints).
export function showcaseSection(body: string): string | undefined {
  const text = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n");
  const start = /^#{2,3}\s+Showcase\b.*$/im.exec(text);
  if (!start) return undefined;
  const rest = text.slice(start.index + start[0].length);
  const end = /^#{1,2}\s/m.exec(rest);
  return (end ? rest.slice(0, end.index) : rest).trim();
}

export function checkShowcase(pr: PullRequest): Showcase {
  if (
    pr.labels.includes(skipLabel) ||
    pr.headRef.startsWith("release-please--") ||
    pr.author === "dependabot[bot]"
  ) {
    return { kind: "none", problems: [] };
  }
  const kind = classify(pr.files);
  if (kind === "none") return { kind, problems: [] };
  const section = showcaseSection(pr.body ?? "");
  if (!section) {
    return { kind, problems: ['Add a "## Showcase" section to the description.'] };
  }
  const videos = section.match(video)?.length ?? 0;
  const images = section.match(image)?.length ?? 0;
  if (kind === "visual") {
    if (videos > 0 || images >= 2) return { kind, problems: [] };
    return {
      kind,
      problems: [
        "This changes the interface. Add a screen recording, or a before and an after screenshot, under Showcase.",
      ],
    };
  }
  if (videos > 0 || images > 0 || fence.test(section) || table.test(section)) {
    return { kind, problems: [] };
  }
  return {
    kind,
    problems: [
      "This changes behaviour. Show the before and after under Showcase: a Mermaid diagram, a table, a request and response, or test output.",
    ],
  };
}

function main(filesPath: string): void {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as {
    pull_request: {
      body: string | null;
      labels: { name: string }[];
      head: { ref: string };
      user: { login: string };
    };
  };
  const pr = event.pull_request;
  const result = checkShowcase({
    body: pr.body,
    labels: pr.labels.map((label) => label.name),
    headRef: pr.head.ref,
    author: pr.user.login,
    files: readFileSync(filesPath, "utf8").split("\n").filter(Boolean),
  });
  const summary =
    result.problems.length === 0
      ? result.kind === "none"
        ? "Showcase: not needed (no interface or behaviour change)."
        : `Showcase: found (${result.kind} change).`
      : `Showcase missing (${result.kind} change):\n\n${result.problems.map((p) => `- ${p}`).join("\n")}\n\nSee CONTRIBUTING.md#showcase-your-change. Editing the description re-runs this check.`;
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  console.log(summary);
  if (result.problems.length > 0) process.exit(1);
}

if (import.meta.main) main(process.argv[2] ?? "");
