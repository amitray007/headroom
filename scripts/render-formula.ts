/**
 * Print the Homebrew formula (Formula/headroom.rb) for one release.
 *
 * Usage: bun scripts/render-formula.ts <version> <path to SHA256SUMS>
 * The homebrew workflow runs it and commits the output to Formula/headroom.rb in this repository, which is its own tap.
 * See docs/operations/install.md.
 */
import { readFileSync } from "node:fs";

const releases = "https://github.com/amitray007/headroom/releases/download";

const targets = [
  { os: "macos", cpu: "arm", asset: "headroom-darwin-arm64.tar.gz" },
  { os: "macos", cpu: "intel", asset: "headroom-darwin-x64.tar.gz" },
  { os: "linux", cpu: "arm", asset: "headroom-linux-arm64.tar.gz" },
  { os: "linux", cpu: "intel", asset: "headroom-linux-x64.tar.gz" },
] as const;

/** Read `<sha256>  <filename>` lines into a map from filename to digest. */
export function parseSums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([0-9a-f]{64}) [ *](\S+)$/.exec(line.trim());
    if (match?.[1] && match[2]) sums.set(match[2], match[1]);
  }
  return sums;
}

export function renderFormula(version: string, sumsText: string): string {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`not a version: ${version} (use 1.2.3, without the v)`);
  }
  const sums = parseSums(sumsText);
  const block = (os: "macos" | "linux"): string => {
    const cpus = targets
      .filter((t) => t.os === os)
      .map((t) => {
        const sha = sums.get(t.asset);
        if (!sha) throw new Error(`SHA256SUMS has no entry for ${t.asset}`);
        return `    on_${t.cpu} do
      url "${releases}/v${version}/${t.asset}"
      sha256 "${sha}"
    end`;
      });
    return `  on_${os} do\n${cpus.join("\n")}\n  end`;
  };
  return `class Headroom < Formula
  desc "Self-hosted dashboard for all your AI plans"
  homepage "https://headroom.theblank.club"
  version "${version}"
  license "MIT"

${block("macos")}

${block("linux")}

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
`;
}

if (import.meta.main) {
  const [version, sumsPath] = Bun.argv.slice(2);
  if (!version || !sumsPath) {
    process.stderr.write("usage: bun scripts/render-formula.ts <version> <SHA256SUMS path>\n");
    process.exit(2);
  }
  process.stdout.write(renderFormula(version, readFileSync(sumsPath, "utf8")));
}
