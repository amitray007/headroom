#!/bin/sh
# Install Headroom: curl -fsSL https://headroom.theblank.club/install | sh
#
# Environment:
#   HEADROOM_VERSION        Release to install, such as 0.2.0 or v0.2.0. Default: the latest release.
#   HEADROOM_INSTALL_DIR    Where to put the binary. Default: $HOME/.local/bin.
#   HEADROOM_DOWNLOAD_BASE  Releases URL prefix. Default: https://github.com/amitray007/headroom/releases.
#                           Tests point it at a local fake release (file:// works).
#   HEADROOM_TELEMETRY      false or 0 skips the one anonymous install count (OS, CPU and the version
#                           asked for, nothing else). DO_NOT_TRACK=1 and a custom download base skip it too.
#
# Everything runs inside main, called on the last line, so a cut-off download never runs half a script.

set -eu

main() {
  base="${HEADROOM_DOWNLOAD_BASE:-https://github.com/amitray007/headroom/releases}"
  install_dir="${HEADROOM_INSTALL_DIR:-${HOME:?HOME is not set}/.local/bin}"
  version="${HEADROOM_VERSION:-latest}"

  os="$(detect_os)"
  arch="$(detect_arch)"
  asset="headroom-${os}-${arch}.tar.gz"

  if [ "$version" = "latest" ]; then
    url_dir="${base}/latest/download"
  else
    url_dir="${base}/download/v${version#v}"
  fi

  tmp="$(mktemp -d "${TMPDIR:-/tmp}/headroom-install.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  say "Downloading ${asset} (${version})"
  fetch "${url_dir}/${asset}" "${tmp}/${asset}"
  fetch "${url_dir}/SHA256SUMS" "${tmp}/SHA256SUMS"

  verify "$tmp" "$asset"

  mkdir "${tmp}/extract"
  tar -xzf "${tmp}/${asset}" -C "${tmp}/extract"
  [ -f "${tmp}/extract/headroom" ] || die "the archive has no headroom binary"

  mkdir -p "$install_dir"
  # Copy next to the target, then rename: a running headroom is replaced atomically.
  cp "${tmp}/extract/headroom" "${install_dir}/.headroom.new"
  chmod 0755 "${install_dir}/.headroom.new"
  mv -f "${install_dir}/.headroom.new" "${install_dir}/headroom"

  if [ "$os" = "darwin" ]; then
    xattr -d com.apple.quarantine "${install_dir}/headroom" 2>/dev/null || true
  fi

  say ""
  say "Installed $("${install_dir}/headroom" --version) to ${install_dir}/headroom"
  count_install "$os" "$arch" "$version"

  say ""
  say "Next:"
  say "  headroom --open             start Headroom and open the dashboard"
  say "  headroom service install    start Headroom at login"
  path_hint "$install_dir"
}

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'headroom install: %s\n' "$*" >&2
  exit 1
}

detect_os() {
  case "$(uname -s)" in
    Darwin) echo darwin ;;
    Linux) echo linux ;;
    MINGW* | MSYS* | CYGWIN*)
      die "Windows is not supported yet. Run Headroom with Docker: https://github.com/amitray007/headroom#quick-start" ;;
    *) die "unsupported system: $(uname -s). Headroom supports macOS and Linux." ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    arm64 | aarch64) echo arm64 ;;
    x86_64 | amd64) echo x64 ;;
    *) die "unsupported CPU: $(uname -m). Headroom supports arm64 and x64." ;;
  esac
}

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1" || die "download failed: $1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1" || die "download failed: $1"
  else
    die "curl or wget is required"
  fi
}

verify() {
  dir="$1"
  asset="$2"
  expected="$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1; exit }' "${dir}/SHA256SUMS")"
  [ -n "$expected" ] || die "SHA256SUMS has no entry for ${asset}"
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "${dir}/${asset}" | awk '{ print $1 }')"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "${dir}/${asset}" | awk '{ print $1 }')"
  else
    die "shasum or sha256sum is required to verify the download"
  fi
  [ "$actual" = "$expected" ] || die "checksum mismatch for ${asset} (expected ${expected}, got ${actual}); nothing was installed"
}

# One anonymous event so the maintainer can count installs (ADR 0007). A random ID, the OS, the CPU and
# the version asked for; it never waits more than 3 seconds and never fails the install.
count_install() {
  [ -z "${HEADROOM_DOWNLOAD_BASE:-}" ] || return 0
  case "${HEADROOM_TELEMETRY:-true}" in false | 0) return 0 ;; esac
  [ "${DO_NOT_TRACK:-}" != "1" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  asked="custom"
  if [ "$3" = "latest" ] || printf '%s' "$3" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+$'; then asked="$3"; fi
  id="$(od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')"
  body="{\"api_key\":\"phc_mFhU4x7B3Ze55gPVQJozu9tpkEzTtUh3kBdq2PtDi2uN\",\"batch\":[{\"event\":\"install_script\",\"distinct_id\":\"${id:-unknown}\",\"properties\":{\"os\":\"$1\",\"arch\":\"$2\",\"version\":\"${asked}\",\"\$process_person_profile\":false,\"\$geoip_disable\":true}}]}"
  curl -fsS -m 3 -o /dev/null -H 'content-type: application/json' --data "$body" \
    https://hd.headroom.theblank.club/batch/ >/dev/null 2>&1 || true
}

path_hint() {
  case ":${PATH}:" in
    *":$1:"*) return 0 ;;
  esac
  say ""
  say "$1 is not on your PATH. Add it:"
  say "  bash or zsh:  echo 'export PATH=\"$1:\$PATH\"' >> ~/.zshrc   (use ~/.bashrc for bash)"
  say "  fish:         fish_add_path $1"
}

main "$@"
