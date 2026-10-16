class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.8"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.8/headroom-darwin-arm64.tar.gz"
      sha256 "897e1c9dbf8e4724cb518b905a77ffb1814ecc35a5fbf4eb3f40a1954f3000a6"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.8/headroom-darwin-x64.tar.gz"
      sha256 "7807d787db0f3c6da122507970b49fbe9fa83608a0da924820340d78c551ea00"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.8/headroom-linux-arm64.tar.gz"
      sha256 "83f28ccf7cd11b34828da203f0fcb7b2428364d75803c02bd085270761ecc56b"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.8/headroom-linux-x64.tar.gz"
      sha256 "2f25d8e853be92bdd1b6829f27b571ce5e123def4b0d1ad855362c8ba9c8a924"
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
