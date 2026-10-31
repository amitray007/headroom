import { expect, test } from "bun:test";

import { renderCask } from "./render-cask.ts";

const sha = "a1".repeat(32);

test("the cask pins the universal Mac archive and checksum", () => {
  const cask = renderCask("1.2.3", `${sha}  Headroom-1.2.3.zip\n`);
  expect(cask).toContain('cask "headroom-mac" do');
  expect(cask).toContain('version "1.2.3"');
  expect(cask).toContain(`sha256 "${sha}"`);
  expect(cask).toContain(
    'url "https://github.com/amitray007/headroom/releases/download/macos-v#{version}/Headroom-#{version}.zip"',
  );
  expect(cask).toContain('depends_on macos: ">= :sequoia"');
  expect(cask).toContain('homepage "https://headroom.theblank.club/"');
  expect(cask).toContain("regex(/^macos-v(\\d+(?:\\.\\d+)+)$/i)");
  expect(cask).toContain("strategy :github_releases");
  expect(cask).toContain('app "Headroom.app"');
  expect(cask).toContain('system_command "/usr/bin/xattr"');
  expect(cask).toContain('args: ["-dr", "com.apple.quarantine", "#{appdir}/Headroom.app"]');
});

test("zap removes client state and the widget container without deleting server data", () => {
  const cask = renderCask("1.2.3", `${sha} *Headroom-1.2.3.zip\n`);
  expect(cask).toContain('"~/Library/Containers/club.theblank.headroom.mac.widgets"');
  expect(cask).toContain('"~/Library/Preferences/club.theblank.headroom.mac.plist"');
  expect(cask).toContain('"~/Library/Caches/club.theblank.headroom.mac"');
  expect(cask).toContain('"~/Library/Application Support/club.theblank.headroom.mac"');
  expect(cask).not.toContain('"~/Library/Application Support/Headroom"');
  expect(cask).not.toContain("headroom.key");
  expect(cask).not.toContain("/data");
});

test("a bad version, missing asset or malformed checksum cannot render a cask", () => {
  for (const version of ["v1.2.3", "1.2", "1.2.3-rc.1", '1.2.3"\n']) {
    expect(() => renderCask(version, `${sha}  Headroom-1.2.3.zip\n`)).toThrow("not a version");
  }
  for (const sums of ["", `${sha}  Headroom-1.2.2.zip`, "invalid  Headroom-1.2.3.zip"]) {
    expect(() => renderCask("1.2.3", sums)).toThrow("Headroom-1.2.3.zip");
  }
});
