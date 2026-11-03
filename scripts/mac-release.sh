#!/usr/bin/env bash
# Upload only to a draft. An interrupted upload stays private; retries verify existing assets.
set -euo pipefail

version=${1:?usage: mac-release.sh <version> <asset directory>}
assets=${2:?usage: mac-release.sh <version> <asset directory>}
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'invalid Mac version' >&2; exit 1; }
: "${GH_REPO:?GH_REPO must name the release repository}"
tag="macos-v$version"
archive="Headroom-$version.zip"
cd "$assets"
test -s "$archive"
test -s SHA256SUMS
shasum -a 256 -c SHA256SUMS

# Never let a Mac release supply releases/latest, even during a retry.
server_latest() {
  local server
  server=$(gh api --paginate --slurp "repos/$GH_REPO/releases?per_page=100" --jq \
    '[.[][] | select(.draft == false and .prerelease == false) | select(.tag_name | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$"))] | sort_by(.published_at) | last | .tag_name // empty')
  test -n "$server" || { echo 'no published server release; refusing Mac publication' >&2; return 1; }
  gh release edit "$tag" --latest=false
  gh release edit "$server" --latest
}
server_latest

draft=$(gh release view "$tag" --json isDraft --jq .isDraft)
if [ "$draft" = true ]; then
  # GitHub uploads files separately. Keep the release a draft until BOTH round-trip checks pass.
  gh release upload "$tag" "$archive" SHA256SUMS --clobber
fi

# On a rerun after publication, reuse the immutable release bytes instead of replacing them.
verify_dir=$(mktemp -d)
trap 'rm -rf "$verify_dir"' EXIT
gh release download "$tag" --pattern "$archive" --pattern SHA256SUMS --dir "$verify_dir"
(
  cd "$verify_dir"
  shasum -a 256 -c SHA256SUMS
)
if [ "$draft" = true ]; then
  cmp SHA256SUMS "$verify_dir/SHA256SUMS"
  cmp "$archive" "$verify_dir/$archive"
  gh release edit "$tag" --draft=false --latest=false
else
  # The next cask render must use the PUBLISHED digest, not a non-reproducible rebuild's digest.
  cp "$verify_dir/SHA256SUMS" SHA256SUMS
fi
server_latest
