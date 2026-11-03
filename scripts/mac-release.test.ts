import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dir, "mac-release.sh");
const archive = "Headroom-1.2.3.zip";
const digest = (bytes: string): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

// The fake CLI has no network access. A failed upload leaves only the ZIP in the remote folder.
const fakeGh = `#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$1 $2" in
  'api --paginate')
    if [ "$FAKE_NO_SERVER" != 1 ]; then echo v4.5.6; fi ;;
  'release view') echo "$FAKE_DRAFT" ;;
  'release edit') ;;
  'release upload')
    cp "$4" "$FAKE_REMOTE/"
    if [ "$FAKE_FAIL_UPLOAD" = 1 ]; then exit 1; fi
    cp "$5" "$FAKE_REMOTE/" ;;
  'release download')
    while [ "$1" != --dir ]; do shift; done
    cp "$FAKE_REMOTE/Headroom-1.2.3.zip" "$FAKE_REMOTE/SHA256SUMS" "$2/"
    if [ "$FAKE_CORRUPT_DOWNLOAD" = 1 ]; then printf broken >> "$2/Headroom-1.2.3.zip"; fi ;;
  *) exit 99 ;;
esac
`;

function runRelease(options: Record<string, string> = {}, remoteBytes = "published app") {
  const root = mkdtempSync(join(tmpdir(), "headroom-mac-release-"));
  try {
    const assets = join(root, "assets");
    const remote = join(root, "remote");
    const bin = join(root, "bin");
    for (const dir of [assets, remote, bin]) mkdirSync(dir);
    writeFileSync(join(bin, "gh"), fakeGh, { mode: 0o755 });
    writeFileSync(join(assets, archive), "local app");
    writeFileSync(join(assets, "SHA256SUMS"), `${digest("local app")}  ${archive}\n`);
    writeFileSync(join(remote, archive), remoteBytes);
    const remoteSums = `${digest("published app")}  ${archive}\n`;
    writeFileSync(join(remote, "SHA256SUMS"), remoteSums);
    const log = join(root, "commands");
    const result = Bun.spawnSync(["bash", script, "1.2.3", assets], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        GH_REPO: "example/headroom",
        FAKE_LOG: log,
        FAKE_REMOTE: remote,
        FAKE_DRAFT: "true",
        FAKE_NO_SERVER: "0",
        FAKE_FAIL_UPLOAD: "0",
        FAKE_CORRUPT_DOWNLOAD: "0",
        ...options,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: result.exitCode,
      log: readFileSync(log, "utf8"),
      sums: readFileSync(join(assets, "SHA256SUMS"), "utf8"),
      remoteSums,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("draft assets round-trip before publication and server latest is restored", () => {
  const result = runRelease();
  expect(result.code).toBe(0);
  expect(result.log).toContain(`release upload macos-v1.2.3 ${archive} SHA256SUMS --clobber`);
  expect(result.log.indexOf("release download")).toBeLessThan(
    result.log.indexOf("--draft=false --latest=false"),
  );
  expect(result.log).toEndWith(
    "release edit macos-v1.2.3 --latest=false\nrelease edit v4.5.6 --latest\n",
  );
});

test("a partial upload stays a draft", () => {
  const result = runRelease({ FAKE_FAIL_UPLOAD: "1" });
  expect(result.code).not.toBe(0);
  expect(result.log).not.toContain("--draft=false");
  expect(result.log).not.toContain("release download");
});

test("a corrupted draft download cannot publish", () => {
  const result = runRelease({ FAKE_CORRUPT_DOWNLOAD: "1" });
  expect(result.code).not.toBe(0);
  expect(result.log).toContain("release upload");
  expect(result.log).toContain("release download");
  expect(result.log).not.toContain("--draft=false");
});

test("a published rerun keeps remote bytes and renders from the published checksum", () => {
  const result = runRelease({ FAKE_DRAFT: "false" });
  expect(result.code).toBe(0);
  expect(result.log).not.toContain("release upload");
  expect(result.log).not.toContain("--draft=false");
  expect(result.sums).toBe(result.remoteSums);
});

test("bad remote bytes fail without replacing a published asset", () => {
  const result = runRelease({ FAKE_DRAFT: "false" }, "corrupted app");
  expect(result.code).not.toBe(0);
  expect(result.log).not.toContain("release upload");
  expect(result.log).not.toContain("--draft=false");
});

test("a missing server release prevents any Mac upload or publication", () => {
  const result = runRelease({ FAKE_NO_SERVER: "1" });
  expect(result.code).not.toBe(0);
  expect(result.log).not.toContain("release edit");
  expect(result.log).not.toContain("release upload");
});
