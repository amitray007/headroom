cask "headroom-mac" do
  version "0.1.0"
  # No archive exists until the first owner release. The release job replaces this cask.
  sha256 :no_check

  url "https://github.com/amitray007/headroom/releases/download/macos-v#{version}/Headroom-#{version}.zip"
  name "Headroom"
  desc "Menu bar dashboard and widgets for your AI plans"
  homepage "https://headroom.theblank.club/"

  livecheck do
    url "https://github.com/amitray007/headroom/releases"
    regex(/^macos-v(\d+(?:\.\d+)+)$/i)
    strategy :github_releases
  end

  disable! date: "2026-10-30", because: "is awaiting its first release"

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
