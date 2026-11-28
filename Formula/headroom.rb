class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.19"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.19/headroom-darwin-arm64.tar.gz"
      sha256 "1846925221e47708c6d5e35e7d0b76c3edf65d2491c0aca6f5de777b1599c188"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.19/headroom-darwin-x64.tar.gz"
      sha256 "70886ba3096d8e28b21d67e4f0ee31792913903a6f9135c3f017bfd7eb3435b1"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.19/headroom-linux-arm64.tar.gz"
      sha256 "73013831ac9844d61450884acb82151546d62af7b08c0307f92a332e1245537e"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.19/headroom-linux-x64.tar.gz"
      sha256 "56fda7eb5a958004ac2d0705d5b86ccb651ab1a141187f187ba9a3743d91293e"
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
