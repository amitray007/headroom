class Headroom < Formula
  desc "Self-hosted dashboard for AI account limits, balances and usage"
  homepage "https://headroom.theblank.club"
  version "0.1.2"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.2/headroom-darwin-arm64.tar.gz"
      sha256 "29b54778c33a57f69f24a6dd526b6ec25b8a660b8f3671585bbfd777c7ee9c4e"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.2/headroom-darwin-x64.tar.gz"
      sha256 "8a8f0fae1a56a5865c06f029812388e13197afe5ca73150b19b23a84ae54d7c6"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.2/headroom-linux-arm64.tar.gz"
      sha256 "4c1d8b8c5b5feb7445bb6dd23be95f8bb07590eaa598415bd5b8db8ec402a92f"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.2/headroom-linux-x64.tar.gz"
      sha256 "809628abde2e55dc43da1f758ca660f868ea275bfabe850a0b3a46d0b38f5c8d"
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
