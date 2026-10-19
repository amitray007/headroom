class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.12"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.12/headroom-darwin-arm64.tar.gz"
      sha256 "9b2c4065ab9900bee54bfcb4e9c9859e40acc5a1a7a1975559ba1dafecc78552"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.12/headroom-darwin-x64.tar.gz"
      sha256 "1d35404c55eb38e6cdfb6a7667aca9202abe9a55f948b6f8d2666b9ea8797764"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.12/headroom-linux-arm64.tar.gz"
      sha256 "3bb73da521b2ed9f7c2efb9cb3c34783a219738bc7835cc00520119eef461678"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.12/headroom-linux-x64.tar.gz"
      sha256 "d5f5ead083d7d270e1a219c715ba38d839c43438839fe94909d491adff91bf0b"
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
