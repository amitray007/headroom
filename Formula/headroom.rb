class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "0.1.13"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.13/headroom-darwin-arm64.tar.gz"
      sha256 "6d987e1f4b0809ba1763e562455f8d914be17ecf2add635dcf9d41dbe64f4217"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.13/headroom-darwin-x64.tar.gz"
      sha256 "6018592c114fa712379798d3bd94265450a2a96ed3edb83d7af07fa53674819d"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.13/headroom-linux-arm64.tar.gz"
      sha256 "790f15c82af993dee1157ca200cb3dfa9fd00a9399eb14ed278d8105c4d77b93"
    end
    on_intel do
      url "https://github.com/amitray007/headroom/releases/download/v0.1.13/headroom-linux-x64.tar.gz"
      sha256 "6dab23f74dada982020cc43d9b58599209166143bfb961aca1e6532e6cc9596a"
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
