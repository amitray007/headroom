class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.3"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.3/headroom-darwin-arm64.tar.gz"
      sha256 "2d79e4bdaab6620df7d16787352a3803c31bf9e5f410648517124295f5a07d8f"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.3/headroom-darwin-x64.tar.gz"
      sha256 "973a17721bfadd5548730a23a0961892b95029b0ace1d38eb9b8d03300c54edc"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.3/headroom-linux-arm64.tar.gz"
      sha256 "19252b3954554aa9b4851d02405d6b86e5e06f19a559c32a7c6ac4989d3a239b"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.3/headroom-linux-x64.tar.gz"
      sha256 "e4964624e376941617a272d8e8eb8776f6ef4687bf5604908fec77b10c91a3ce"
    end
  end

  def install
    bin.install "headroom"
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
