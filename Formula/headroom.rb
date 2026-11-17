class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.18"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.18/headroom-darwin-arm64.tar.gz"
      sha256 "e47e51ced7415aad033d7ee33f5a45a32b8f8a68b29e1c135fd6550d79d727ff"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.18/headroom-darwin-x64.tar.gz"
      sha256 "0f528193dc5d5e35a0a1e1fcc242ff839cca7f7795693c76495f2a0a293bc611"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.18/headroom-linux-arm64.tar.gz"
      sha256 "42032d35f481ae0e118374904f87ef3efbb02d8af6a326156ea24fcb487e6d3a"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.18/headroom-linux-x64.tar.gz"
      sha256 "ede295e68a71a1e3e9e485b881d16086c6a2e5ce968427c7514b2a213cf3ff57"
    end
  end

  def install
    bin.install "headroom"
    prefix.install "THIRD_PARTY_NOTICES.md"
  end

  service do
    run [opt_bin/"headroom", "start"]
    keep_alive true
    log_path var/"log/headroom.log"
    error_log_path var/"log/headroom.log"
  end

  def caveats
    <<~EOS
      Open the dashboard:
        headroom --open

      Start Headroom now and at every login:
        brew services start headroom
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/headroom --version")
  end
end
