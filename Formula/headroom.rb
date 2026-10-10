class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.5"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.5/headroom-darwin-arm64.tar.gz"
      sha256 "c371ede92f3b2035d492e48012b1bbe17ec9c42ae2375ea2d2e0c0a41784332b"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.5/headroom-darwin-x64.tar.gz"
      sha256 "bce45dc75b1344594e1990ffa3ea86e5ae5f048577fd7f825b4d13e5e89f3a4b"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.5/headroom-linux-arm64.tar.gz"
      sha256 "3b95cc2564c1f20abc9f0a310a4ce39dfa5c2073b8b4f3393f54a41eaf905879"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.5/headroom-linux-x64.tar.gz"
      sha256 "486361d0540423a7687afaaea64558dab944a62471b5dd91c0cc659b39e74fc6"
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
