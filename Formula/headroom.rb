class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.14"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.14/headroom-darwin-arm64.tar.gz"
      sha256 "68f4bedf39d58762f0761378e939494e4d32204d7b7ecc9b8814dc779807a2b6"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.14/headroom-darwin-x64.tar.gz"
      sha256 "9f25644614404210eda7ea93bc0bee76e6d6a82c5bae3037adea9a99d1f8339a"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.14/headroom-linux-arm64.tar.gz"
      sha256 "0bad9910c9fa01bdd1247111efdcbf9d6f55ed9fb056b185845b7d445b902963"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.14/headroom-linux-x64.tar.gz"
      sha256 "7a29f8bde641598e0995482058d7e9bb52a4410ffe3f8c02892d07f640940c8c"
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
