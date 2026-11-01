#!/usr/bin/env bash
# Build a Release Headroom and make it the only copy macOS knows about.
# WidgetKit picks any registered copy of the widget extension, so a stale build left
# registered can supply old widget code or an old account picker.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
target="$HOME/Applications/Headroom.app"
derived="$root/apps/macos/.derived-data"
built="$derived/Build/Products/Release/Headroom.app"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
version=$(cat "$root/apps/macos/version.txt")
# A rising build number lets macOS rank this copy above any copy it still remembers.
build=$(date +%y%m%d.%H%M)

if [ -d /Applications/Headroom.app ]; then
  echo 'Headroom from the Homebrew cask is in /Applications. Run: brew uninstall --cask headroom-mac' >&2
  exit 1
fi

xcodebuild -project "$root/apps/macos/Headroom.xcodeproj" -scheme Headroom -configuration Release \
  -derivedDataPath "$derived" -skipPackagePluginValidation -skipMacroValidation \
  -onlyUsePackageVersionsFromResolvedFile MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build" \
  build -quiet

pkill -x Headroom || true
# Unregister every other copy: earlier installs, Debug builds and other worktrees.
"$lsregister" -dump | sed -n 's/^path: *\(.*Headroom\.app\) (0x[0-9a-f]*)$/\1/p' | sort -u |
  while IFS= read -r app; do
    [ "$app" = "$target" ] && continue
    pluginkit -r "$app/Contents/PlugIns/HeadroomWidgets.appex" 2>/dev/null || true
    "$lsregister" -u "$app" 2>/dev/null || true
    echo "unregistered $app"
  done

rm -rf "$target"
ditto "$built" "$target"
# The build output is a second copy of the same bundle. Remove it so it never registers again.
rm -rf "$built"
codesign --force --deep -s - --preserve-metadata=entitlements,identifier "$target"
xattr -cr "$target"
"$lsregister" -f "$target"
pluginkit -a "$target/Contents/PlugIns/HeadroomWidgets.appex"
# chronod hosts widgets; launchd restarts it and it reloads the extension list.
killall chronod 2>/dev/null || true

open "$target"
echo "installed Headroom $version ($build)"
