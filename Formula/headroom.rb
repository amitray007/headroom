class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.4"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.4/headroom-darwin-arm64.tar.gz"
      sha256 "09e41bdc81eaa879c9acea5841f34eecb3e7e895dccff3ef8009c667977df37c"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.4/headroom-darwin-x64.tar.gz"
      sha256 "04aae2b24d46263ab759cfca589cd1600f7010cbac33879a065b9218e74bf387"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.4/headroom-linux-arm64.tar.gz"
      sha256 "f621a08cc6d55e03cd58db948d9ffce751407e9796f0376b34d9a66f35e81104"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.4/headroom-linux-x64.tar.gz"
      sha256 "355a241dfaaaaeda2e9161b32409c77878071b7717b520364db3c4aaa3beadde"
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
