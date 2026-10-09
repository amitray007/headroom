import { createHash } from "node:crypto";

import { expect, test } from "bun:test";

import { assetName, compareVersions, detectInstall, runUpdate, type UpdateDeps } from "./update.ts";

const archive = new TextEncoder().encode("fake archive");
const binary = new TextEncoder().encode("fake binary");
const digest = createHash("sha256").update(archive).digest("hex");

interface Harness {
  deps: UpdateDeps;
  urls: string[];
  files: Map<string, Uint8Array>;
  renames: [string, string][];
}

function harness(
  over: {
    tag?: string;
    sums?: string;
    version?: string;
    apiStatus?: number;
    files?: string[];
  } = {},
): Harness {
  const urls: string[] = [];
  const files = new Map<string, Uint8Array>();
  const renames: [string, string][] = [];
  const present = new Set(over.files ?? []);
  const deps: UpdateDeps = {
    version: over.version ?? "0.1.0",
    execPath: "/home/u/.local/bin/headroom",
    platform: "linux",
    arch: "x64",
    home: "/home/u",
    fetch: async (url) => {
      urls.push(url);
      if (new URL(url).hostname === "api.github.com") {
        return Response.json({ tag_name: over.tag ?? "v0.2.0" }, { status: over.apiStatus ?? 200 });
      }
      if (url.endsWith("SHA256SUMS")) {
        return new Response(over.sums ?? `${digest}  headroom-linux-x64.tar.gz\n`);
      }
      return new Response(archive);
    },
    extractBinary: async () => binary,
    writeExecutable: (path, bytes) => void files.set(path, bytes),
    rename: (from, to) => {
      renames.push([from, to]);
      files.set(to, files.get(from) ?? new Uint8Array());
      files.delete(from);
    },
    remove: (path) => void files.delete(path),
    exists: (path) => present.has(path),
  };
  return { deps, urls, files, renames };
}

test("the install kind comes from the executable path", () => {
  expect(detectInstall("/opt/homebrew/Cellar/headroom/0.1.0/bin/headroom", false)).toBe("homebrew");
  expect(detectInstall("/home/linuxbrew/.linuxbrew/Cellar/headroom/1/bin/headroom", false)).toBe(
    "homebrew",
  );
  expect(detectInstall("/x/node_modules/headroomhq/bin/headroom", false)).toBe("npm");
  expect(detectInstall("/x/lib/python3/site-packages/headroomhq/headroom", false)).toBe("python");
  expect(detectInstall("/home/u/.local/share/uv/tools/headroomhq/bin/headroom", false)).toBe(
    "python",
  );
  expect(detectInstall("/home/u/.local/pipx/venvs/headroomhq/bin/headroom", false)).toBe("python");
  expect(detectInstall("/usr/local/bin/headroom", true)).toBe("docker");
  expect(detectInstall("/usr/local/bin/headroom", false)).toBe("standalone");
  expect(detectInstall("/home/u/.local/bin/headroom", true)).toBe("standalone");
});

test("versions compare by number, not by text", () => {
  expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  expect(compareVersions("0.1.1", "0.2.0")).toBeLessThan(0);
  expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(0);
});

test("assets exist for the four supported machines only", () => {
  expect(assetName("darwin", "arm64")).toBe("headroom-darwin-arm64.tar.gz");
  expect(assetName("linux", "x64")).toBe("headroom-linux-x64.tar.gz");
  expect(assetName("win32", "x64")).toBeUndefined();
  expect(assetName("linux", "ia32")).toBeUndefined();
});

test("a managed install prints its own update command and touches nothing", async () => {
  const h = harness();
  const brew = await runUpdate(
    { check: false },
    { ...h.deps, execPath: "/opt/homebrew/Cellar/headroom/0.1.0/bin/headroom" },
    false,
  );
  expect(brew.lines.join("\n")).toContain("brew upgrade headroom");
  const npm = await runUpdate(
    { check: false },
    { ...h.deps, execPath: "/a/node_modules/h/h" },
    false,
  );
  expect(npm.lines.join("\n")).toContain("npm i -g headroomhq@latest");
  const py = await runUpdate(
    { check: false },
    { ...h.deps, execPath: "/a/site-packages/h/h" },
    false,
  );
  expect(py.lines.join("\n")).toContain("uv tool upgrade headroomhq");
  const docker = await runUpdate(
    { check: false },
    { ...h.deps, execPath: "/usr/local/bin/headroom" },
    true,
  );
  expect(docker.lines.join("\n")).toContain("docker pull");
  expect(h.urls).toEqual([]);
});

test("--check reports a newer release and changes nothing", async () => {
  const h = harness();
  const out = await runUpdate({ check: true }, h.deps, false);
  expect(out.code).toBe(0);
  expect(out.lines[0]).toContain("0.2.0 is available");
  expect(h.urls).toHaveLength(1);
  expect(h.files.size).toBe(0);
});

test("an up-to-date binary downloads nothing", async () => {
  const h = harness({ version: "0.2.0" });
  const out = await runUpdate({ check: false }, h.deps, false);
  expect(out.lines[0]).toContain("up to date");
  expect(h.urls).toHaveLength(1);
});

test("an update verifies the archive and swaps the file in place", async () => {
  const h = harness({ files: ["/home/u/.config/systemd/user/headroom.service"] });
  const out = await runUpdate({ check: false }, h.deps, false);
  expect(out.code).toBe(0);
  expect(out.lines[0]).toBe("Updated headroom 0.1.0 -> 0.2.0.");
  expect(out.lines.join("\n")).toContain("runs as a login service here");
  expect(out.lines.join("\n")).toContain("systemctl --user restart headroom");
  expect(h.urls).toContain(
    "https://github.com/amitray007/headroom/releases/download/v0.2.0/headroom-linux-x64.tar.gz",
  );
  expect(h.renames).toEqual([["/home/u/.local/bin/headroom.new", "/home/u/.local/bin/headroom"]]);
  expect(h.files.get("/home/u/.local/bin/headroom")).toEqual(binary);
  expect(h.files.has("/home/u/.local/bin/headroom.new")).toBe(false);
});

test("a checksum mismatch aborts before any write", async () => {
  const h = harness({ sums: `${"0".repeat(64)}  headroom-linux-x64.tar.gz\n` });
  const out = await runUpdate({ check: false }, h.deps, false);
  expect(out.code).toBe(1);
  expect(out.lines[0]).toContain("Checksum mismatch");
  expect(h.files.size).toBe(0);
});

test("a missing checksum entry, a bad tag and an API error all fail cleanly", async () => {
  expect((await runUpdate({ check: false }, harness({ sums: "" }).deps, false)).code).toBe(1);
  expect((await runUpdate({ check: false }, harness({ tag: "nightly" }).deps, false)).code).toBe(1);
  const failed = await runUpdate({ check: false }, harness({ apiStatus: 404 }).deps, false);
  expect(failed.code).toBe(1);
  expect(failed.lines[0]).toContain("HTTP 404");
});

test("a write failure removes the staged file and reports it", async () => {
  const h = harness();
  const removed: string[] = [];
  const deps: UpdateDeps = {
    ...h.deps,
    rename: () => {
      throw new Error("EACCES");
    },
    remove: (path) => void removed.push(path),
  };
  const out = await runUpdate({ check: false }, deps, false);
  expect(out.code).toBe(1);
  expect(out.lines[0]).toContain("EACCES");
  expect(removed).toEqual(["/home/u/.local/bin/headroom.new"]);
});
