class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.9"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.9/headroom-darwin-arm64.tar.gz"
      sha256 "6620584dc11b3f87fca506d2adc1d4e55e1864c8bffd2836a55f2e1d39097850"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.9/headroom-darwin-x64.tar.gz"
      sha256 "115774098512075d32bb2c924e7a59b3b3a7af4d8acff08963e589cd17db3f4c"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.9/headroom-linux-arm64.tar.gz"
      sha256 "6d37ce281ce4aab843fc4ababa1eace92eb7d97bbd607952f9175b3a73c4fab5"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.9/headroom-linux-x64.tar.gz"
      sha256 "7e920701ef042520ccda7d3e94be9b0d3d10fd9995626e13096a6be6e8b804d6"
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
