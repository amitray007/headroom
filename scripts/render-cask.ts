/** Print Casks/headroom-mac.rb for a Mac release. See docs/operations/releases.md. */
import { readFileSync } from "node:fs";

import { parseSums } from "./render-formula.ts";

export function renderCask(version: string, sumsText: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`not a version: ${version} (use 1.2.3, without the v)`);
  }
  const asset = `Headroom-${version}.zip`;
  const sha = parseSums(sumsText).get(asset);
  if (!sha) throw new Error(`SHA256SUMS has no entry for ${asset}`);
  return `cask "headroom-mac" do
  version "${version}"
  sha256 "${sha}"

  url "https://github.com/amitray007/headroom/releases/download/macos-v#{version}/Headroom-#{version}.zip"
  name "Headroom"
  desc "Menu bar dashboard and widgets for your AI plans"
  homepage "https://headroom.theblank.club/"

  livecheck do
    url "https://github.com/amitray007/headroom/releases"
    regex(/^macos-v(\\d+(?:\\.\\d+)+)$/i)
    strategy :github_releases
  end

  depends_on macos: ">= :sequoia"

  app "Headroom.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Headroom.app"]
  end

  zap trash: [
    "~/Library/Application Support/club.theblank.headroom.mac",
    "~/Library/Caches/club.theblank.headroom.mac",
    "~/Library/Containers/club.theblank.headroom.mac.widgets",
    "~/Library/Preferences/club.theblank.headroom.mac.plist",
  ]
end
`;
}

if (import.meta.main) {
  const [version, sumsPath] = Bun.argv.slice(2);
  if (!version || !sumsPath) {
    process.stderr.write("usage: bun scripts/render-cask.ts <version> <SHA256SUMS path>\n");
    process.exit(2);
  }
  process.stdout.write(renderCask(version, readFileSync(sumsPath, "utf8")));
}
