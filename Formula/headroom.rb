class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.6"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.6/headroom-darwin-arm64.tar.gz"
      sha256 "c7e7172f8db94c93bb6bec1ef8a041161faef3f0a389a9a2622d5ccccd510bf1"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.6/headroom-darwin-x64.tar.gz"
      sha256 "3e0b7051da1ec72f0d4abe9a24ae9e60f805752958035e17a977fa58c7f422ad"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.6/headroom-linux-arm64.tar.gz"
      sha256 "9ad55ac694caf75b387f64fddf4ae775d5d63b1faed87164cf51270a50ac78bb"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.6/headroom-linux-x64.tar.gz"
      sha256 "5318f183dfcbd588a34adc29b8a651bae320cb104b92a4ad69c22d8584247ce8"
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
