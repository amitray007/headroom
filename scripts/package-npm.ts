/**
 * Generate the npm packages from the release archives.
 *
 *   bun scripts/package-npm.ts --version 0.1.1 --assets <dir> --out <dir>
 *
 * <dir> holds the release assets: the four headroom-<os>-<arch>.tar.gz archives and SHA256SUMS. Every archive is
 * checked against SHA256SUMS before it is unpacked. The output has one directory per package: headroomhq (the
 * launcher) and headroomhq-<os>-<arch> (one native binary each). See packaging/README.md.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const repo = join(import.meta.dir, "..");
const templates = join(repo, "packaging", "npm");

/** Release asset platform -> npm `os` and `cpu` values. */
const platforms = [
  { id: "darwin-arm64", os: "darwin", cpu: "arm64" },
  { id: "darwin-x64", os: "darwin", cpu: "x64" },
  { id: "linux-x64", os: "linux", cpu: "x64" },
  { id: "linux-arm64", os: "linux", cpu: "arm64" },
] as const;

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    assets: { type: "string" },
    out: { type: "string" },
  },
});
const { version, assets, out } = values;
if (version === undefined || assets === undefined || out === undefined) {
  console.error("usage: package-npm.ts --version X.Y.Z --assets <dir> --out <dir>");
  process.exit(2);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`version must be X.Y.Z, got ${version}`);
  process.exit(2);
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fill(text: string, platform: string): string {
  return text.replaceAll("PLATFORM", platform);
}

const sumsPath = join(assets, "SHA256SUMS");
if (!existsSync(sumsPath)) {
  console.error(`${sumsPath} is missing; refusing to package unverified archives`);
  process.exit(1);
}
const sums = new Map<string, string>();
for (const line of readFileSync(sumsPath, "utf8").split("\n")) {
  const [hash, name] = line.trim().split(/\s+/);
  if (hash !== undefined && name !== undefined)
    sums.set(name.replace(/^\*/, ""), hash.toLowerCase());
}

// Verify everything before writing anything.
for (const platform of platforms) {
  const name = `headroom-${platform.id}.tar.gz`;
  const path = join(assets, name);
  if (!existsSync(path)) {
    console.error(`${path} is missing`);
    process.exit(1);
  }
  if (sums.get(name) !== sha256(path)) {
    console.error(`${name} does not match SHA256SUMS`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "headroom-npm-"));

try {
  const optionalDependencies: Record<string, string> = {};
  for (const platform of platforms) {
    const name = `headroomhq-${platform.id}`;
    const dir = join(out, name);
    const unpack = join(scratch, platform.id);
    mkdirSync(unpack);
    const tar = Bun.spawnSync([
      "tar",
      "-xzf",
      join(assets, `headroom-${platform.id}.tar.gz`),
      "-C",
      unpack,
    ]);
    if (tar.exitCode !== 0)
      throw new Error(`tar failed for ${platform.id}: ${tar.stderr.toString()}`);
    for (const needed of ["headroom", "LICENSE"]) {
      if (!existsSync(join(unpack, needed)))
        throw new Error(`headroom-${platform.id}.tar.gz has no ${needed}`);
    }

    mkdirSync(join(dir, "bin"), { recursive: true });
    copyFileSync(join(unpack, "headroom"), join(dir, "bin", "headroom"));
    chmodSync(join(dir, "bin", "headroom"), 0o755);
    copyFileSync(join(unpack, "LICENSE"), join(dir, "LICENSE"));
    writeFileSync(
      join(dir, "README.md"),
      fill(readFileSync(join(templates, "platform", "README.md"), "utf8"), platform.id),
    );
    const manifest = readJson(join(templates, "platform", "package.json"));
    manifest.name = name;
    manifest.version = version;
    manifest.description = fill(String(manifest.description), platform.id);
    manifest.os = [platform.os];
    manifest.cpu = [platform.cpu];
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    optionalDependencies[name] = version;
  }

  const main = join(out, "headroomhq");
  mkdirSync(join(main, "bin"), { recursive: true });
  copyFileSync(join(templates, "main", "bin", "headroom.js"), join(main, "bin", "headroom.js"));
  chmodSync(join(main, "bin", "headroom.js"), 0o755);
  copyFileSync(join(templates, "main", "README.md"), join(main, "README.md"));
  copyFileSync(join(repo, "LICENSE"), join(main, "LICENSE"));
  const manifest = readJson(join(templates, "main", "package.json"));
  manifest.version = version;
  manifest.optionalDependencies = optionalDependencies;
  writeFileSync(join(main, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`wrote ${platforms.length + 1} packages for ${version} to ${out}`);
