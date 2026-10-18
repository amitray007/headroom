class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.10"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.10/headroom-darwin-arm64.tar.gz"
      sha256 "64079af0ca23b8dacf0aa3be65e55be4c2a3ee8d10d32f059dfa5d239497aec3"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.10/headroom-darwin-x64.tar.gz"
      sha256 "65a119372f80abaaeecb644174771e6fa25fa6f9fcb2d8d6e3b3916dcd8c729f"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.10/headroom-linux-arm64.tar.gz"
      sha256 "b1153b71a21ff04763f57624b2b8babe3c437a1e27f20325a342348aefb5f165"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.10/headroom-linux-x64.tar.gz"
      sha256 "1c08506e35687689f58c5acde85ca5fad725b942f0b083a7cde90aae90d2417f"
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
