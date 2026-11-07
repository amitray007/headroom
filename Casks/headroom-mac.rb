cask "headroom-mac" do
  version "0.1.3"
  sha256 "9a582a50aee2a7c2ec1b70d86b0c23df480a4564b79362330bec22b17c3e9a5f"

  url "https://github.com/amitray007/headroom/releases/download/macos-v#{version}/Headroom-#{version}.zip"
  name "Headroom"
  desc "Menu bar dashboard and widgets for your AI plans"
  homepage "https://headroom.theblank.club/"

  livecheck do
    url "https://github.com/amitray007/headroom/releases"
    regex(/^macos-v(\d+(?:\.\d+)+)$/i)
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
