class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.11"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.11/headroom-darwin-arm64.tar.gz"
      sha256 "2e42da19e50f2bd4d5b9422eb6bca1e088fd6ceeb018b15095737d5123c33439"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.11/headroom-darwin-x64.tar.gz"
      sha256 "2345a9d0d7d167564601c67c6b782e357c28f7b1f9b8311c106c4ab7532d2786"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.11/headroom-linux-arm64.tar.gz"
      sha256 "619f961e06627a46eb0b6c1418ccff51edd218572c10fd2aba9b39b9b7540a5c"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.11/headroom-linux-x64.tar.gz"
      sha256 "8e2b19c2e2dbff0755a24200c4a90a94cbac6b135b71d45f4ceb2c5db04b3bac"
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
