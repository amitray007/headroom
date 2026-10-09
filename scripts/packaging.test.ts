import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const version = "1.2.3";
const ids = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"];
const hostId = `${process.platform}-${process.arch}`;
const hostWheelTag: Partial<Record<string, string>> = {
  "darwin-arm64": "macosx_11_0_arm64",
  "darwin-x64": "macosx_10_15_x86_64",
  "linux-x64": "manylinux_2_17_x86_64.manylinux2014_x86_64",
  "linux-arm64": "manylinux_2_17_aarch64.manylinux2014_aarch64",
};

let work = "";
let assets = "";
let npmOut = "";
let wheelOut = "";

function run(cmd: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync(cmd, {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "headroom-packaging-"));
  assets = join(work, "assets");
  npmOut = join(work, "npm");
  wheelOut = join(work, "wheels");
  mkdirSync(assets);
  const sums: string[] = [];
  for (const id of ids) {
    const staging = join(work, `stage-${id}`);
    mkdirSync(staging);
    // A shell script stands in for the compiled binary.
    writeFileSync(join(staging, "headroom"), `#!/bin/sh\necho "headroom ${version} $*"\n`, {
      mode: 0o755,
    });
    writeFileSync(join(staging, "LICENSE"), "MIT test license\n");
    const archive = join(assets, `headroom-${id}.tar.gz`);
    expect(run(["tar", "-czf", archive, "-C", staging, "headroom", "LICENSE"]).code).toBe(0);
    sums.push(
      `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  headroom-${id}.tar.gz`,
    );
  }
  writeFileSync(join(assets, "SHA256SUMS"), `${sums.join("\n")}\n`);
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

test("package-npm writes five packages with matching versions", () => {
  const result = run([
    "bun",
    join(root, "scripts/package-npm.ts"),
    "--version",
    version,
    "--assets",
    assets,
    "--out",
    npmOut,
  ]);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  const main = JSON.parse(readFileSync(join(npmOut, "headroomhq/package.json"), "utf8")) as {
    version: string;
    bin: Record<string, string>;
    optionalDependencies: Record<string, string>;
    scripts?: unknown;
  };
  expect(main.version).toBe(version);
  expect(main.bin).toEqual({ headroom: "bin/headroom.js", headroomhq: "bin/headroom.js" });
  expect(main.scripts).toBeUndefined();
  expect(main.optionalDependencies).toEqual(
    Object.fromEntries(ids.map((id) => [`headroomhq-${id}`, version])),
  );
  for (const id of ids) {
    const dir = join(npmOut, `headroomhq-${id}`);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(manifest.version).toBe(version);
    expect(manifest.name).toBe(`headroomhq-${id}`);
    expect(manifest.os).toEqual([id.split("-")[0]]);
    expect(manifest.cpu).toEqual([id.split("-")[1]]);
    expect(manifest.preferUnplugged).toBe(true);
    expect(statSync(join(dir, "bin/headroom")).mode & 0o111).toBe(0o111);
    expect(existsSync(join(dir, "LICENSE"))).toBe(true);
  }
});

test("package-npm refuses a tampered archive", () => {
  const bad = join(work, "bad-assets");
  cpSync(assets, bad, { recursive: true });
  writeFileSync(join(bad, "headroom-linux-x64.tar.gz"), "not the archive");
  const result = run([
    "bun",
    join(root, "scripts/package-npm.ts"),
    "--version",
    version,
    "--assets",
    bad,
    "--out",
    join(work, "bad-out"),
  ]);
  expect(result.code).toBe(1);
  expect(result.err).toContain("does not match SHA256SUMS");
  expect(existsSync(join(work, "bad-out"))).toBe(false);
});

test("the npm launcher runs the platform binary and passes arguments and exit code through", () => {
  const modules = join(work, "project/node_modules");
  for (const name of ["headroomhq", ...ids.map((id) => `headroomhq-${id}`)]) {
    cpSync(join(npmOut, name), join(modules, name), { recursive: true });
  }
  const launcher = join(modules, "headroomhq/bin/headroom.js");
  const result = run(["node", launcher, "--version"]);
  expect(result.out).toBe(`headroom ${version} --version\n`);
  expect(result.code).toBe(0);

  // Without the platform package the launcher explains the fix.
  rmSync(join(modules, `headroomhq-${hostId}`), { recursive: true });
  const missing = run(["node", launcher]);
  expect(missing.code).toBe(1);
  expect(missing.err).toContain(`headroomhq-${hostId} is not installed`);
  expect(missing.err).toContain("install.sh");
});

test("package-pypi writes one wheel per platform with a valid RECORD", () => {
  const result = run([
    "python3",
    "-I",
    join(root, "scripts/package-pypi.py"),
    "--version",
    version,
    "--assets",
    assets,
    "--out",
    wheelOut,
  ]);
  expect(result.err).toBe("");
  expect(result.code).toBe(0);
  const check = `
import base64, hashlib, sys, zipfile
wheel = zipfile.ZipFile(sys.argv[1])
names = wheel.namelist()
dist = "headroomhq-${version}.dist-info"
assert f"{dist}/RECORD" in names
for line in wheel.read(f"{dist}/RECORD").decode().splitlines():
    path, digest, size = line.split(",")
    if path == f"{dist}/RECORD":
        assert digest == "" and size == ""
        continue
    data = wheel.read(path)
    assert digest == "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode(), path
    assert int(size) == len(data), path
assert set(names) == {
    "headroomhq/__init__.py", "headroomhq/__main__.py", "headroomhq/bin/headroom",
    f"{dist}/METADATA", f"{dist}/WHEEL", f"{dist}/entry_points.txt", f"{dist}/licenses/LICENSE", f"{dist}/RECORD",
}
assert (wheel.getinfo("headroomhq/bin/headroom").external_attr >> 16) & 0o111 == 0o111
metadata = wheel.read(f"{dist}/METADATA").decode()
assert "Name: headroomhq\\nVersion: ${version}\\n" in metadata
assert "License-Expression: MIT" in metadata
assert "Project-URL: Homepage, https://headroom.theblank.club" in metadata
wheel_file = wheel.read(f"{dist}/WHEEL").decode()
assert "Root-Is-Purelib: false" in wheel_file
print(",".join(line for line in wheel_file.splitlines() if line.startswith("Tag:")))
entry = wheel.read(f"{dist}/entry_points.txt").decode()
assert "headroom = headroomhq:main" in entry and "headroomhq = headroomhq:main" in entry
`;
  const expectedTags: Record<string, string[]> = {
    "darwin-arm64": ["py3-none-macosx_11_0_arm64"],
    "darwin-x64": ["py3-none-macosx_10_15_x86_64"],
    "linux-x64": ["py3-none-manylinux_2_17_x86_64", "py3-none-manylinux2014_x86_64"],
    "linux-arm64": ["py3-none-manylinux_2_17_aarch64", "py3-none-manylinux2014_aarch64"],
  };
  for (const id of ids) {
    const file = join(wheelOut, `headroomhq-${version}-py3-none-${hostWheelTag[id]}.whl`);
    expect(existsSync(file)).toBe(true);
    const verdict = run(["python3", "-I", "-c", check, file]);
    expect(verdict.err).toBe("");
    expect(verdict.code).toBe(0);
    expect(verdict.out.trim()).toBe((expectedTags[id] ?? []).map((tag) => `Tag: ${tag}`).join(","));
  }
});

const uv = Bun.which("uv");
test.skipIf(uv === null || hostWheelTag[hostId] === undefined)(
  "the host wheel installs with uv and both commands run",
  () => {
    const wheel = join(wheelOut, `headroomhq-${version}-py3-none-${hostWheelTag[hostId]}.whl`);
    const env = {
      UV_TOOL_DIR: join(work, "uv-tools"),
      UV_TOOL_BIN_DIR: join(work, "uv-bin"),
      UV_CACHE_DIR: join(work, "uv-cache"),
      UV_PYTHON_DOWNLOADS: "never",
    };
    const install = run([uv ?? "uv", "tool", "install", wheel], env);
    expect(install.err).toContain("headroomhq");
    expect(install.code).toBe(0);
    for (const command of ["headroom", "headroomhq"]) {
      const result = run([join(work, "uv-bin", command), "--version"], env);
      expect(result.out).toBe(`headroom ${version} --version\n`);
    }
  },
);
