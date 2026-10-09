/**
 * Write the README that the npm and PyPI packages show: the repository README with every relative link and image
 * made absolute and pinned to the release tag, so the registry page matches GitHub at that release.
 *
 *   bun scripts/package-readme.ts --version 0.1.3 --out <file>
 *
 * package-npm.ts calls packageReadme directly; package-pypi.py reads the file through --readme. See packaging/README.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const metadata = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "packaging", "metadata.json"), "utf8"),
) as { repository: string };
const raw = metadata.repository.replace(
  "https://github.com/",
  "https://raw.githubusercontent.com/",
);

/** A link or image target that already points somewhere absolute, or within the page. */
function isAbsolute(target: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target);
}

/** Images load from raw.githubusercontent.com. It serves SVG as text unless asked to sanitize it. */
function imageUrl(path: string, tag: string): string {
  const url = `${raw}/${tag}/${path.replace(/^\.\//, "")}`;
  return path.endsWith(".svg") ? `${url}?sanitize=true` : url;
}

function linkUrl(path: string, tag: string): string {
  return `${metadata.repository}/blob/${tag}/${path.replace(/^\.\//, "")}`;
}

const imageFile = /\.(?:png|jpe?g|gif|svg|webp)$/i;

export function packageReadme(markdown: string, version: string): string {
  const tag = `v${version}`;
  const target = (path: string): string =>
    imageFile.test(path) ? imageUrl(path, tag) : linkUrl(path, tag);
  return (
    markdown
      // <img src="path"> and <a href="path">
      .replace(/\b(src|href)="([^"]+)"/g, (match, attribute: string, path: string) =>
        isAbsolute(path) ? match : `${attribute}="${target(path)}"`,
      )
      // [text](path) and ![alt](path), including a badge image inside a link
      .replace(/\]\(([^)\s]+)\)/g, (match, path: string) =>
        isAbsolute(path) ? match : `](${target(path)})`,
      )
  );
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { version: { type: "string" }, out: { type: "string" } },
  });
  if (values.version === undefined || values.out === undefined) {
    console.error("usage: package-readme.ts --version X.Y.Z --out <file>");
    process.exit(2);
  }
  const readme = readFileSync(join(import.meta.dir, "..", "README.md"), "utf8");
  writeFileSync(values.out, packageReadme(readme, values.version));
}
