class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.7"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.7/headroom-darwin-arm64.tar.gz"
      sha256 "8cc46967b87721a1abafc82eb68bc2b20e3966760a9eb75c6cc588d4cc6dbdff"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.7/headroom-darwin-x64.tar.gz"
      sha256 "cc24604ec4e9256c53a259f3aa3ba589d3acee8887e0890602f8e24c32c29b9c"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.7/headroom-linux-arm64.tar.gz"
      sha256 "5dd2f9748cfa7d47a942e8bb6797542bd304174a6d40326365241b9fb6a92100"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.7/headroom-linux-x64.tar.gz"
      sha256 "8a1efae1429720b657c3bf1f8ff4e6cb73e4a4b56ca7530c850ea1b470e7465e"
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
