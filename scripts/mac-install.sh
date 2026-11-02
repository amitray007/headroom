#!/usr/bin/env bash
# Build a Release Headroom and make it the only copy macOS knows about.
# WidgetKit picks any registered copy of the widget extension, so a stale build left
# registered can supply old widget code or an old account picker.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# /Applications, where the cask installs: Notification Center and the Notifications pane in
# System Settings are sandboxed and cannot read ~/Applications, so they drew a blank icon.
target=/Applications/Headroom.app
# Earlier versions of this script installed here.
old="$HOME/Applications/Headroom.app"
# Its own build folder. Debug builds share the main one, and each Debug build made the next
# install rebuild every Swift package.
derived="$root/apps/macos/.derived-data/install"
built="$derived/Build/Products/Release/Headroom.app"
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
version=$(cat "$root/apps/macos/version.txt")
# A rising build number lets macOS rank this copy above any copy it still remembers.
build=$(date +%y%m%d.%H%M)

if brew list --cask headroom-mac >/dev/null 2>&1; then
  echo 'Headroom from the Homebrew cask is installed. Run: brew uninstall --cask headroom-mac' >&2
  exit 1
fi

# ONLY_ACTIVE_ARCH: this Mac's architecture only. Release otherwise builds Intel and Apple
# silicon, which doubled the time.
xcodebuild -project "$root/apps/macos/Headroom.xcodeproj" -scheme Headroom -configuration Release \
  -destination "platform=macOS,arch=$(uname -m)" \
  -derivedDataPath "$derived" -skipPackagePluginValidation -skipMacroValidation \
  -onlyUsePackageVersionsFromResolvedFile MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build" \
  ONLY_ACTIVE_ARCH=YES build -quiet

# The app carries the server. Build it only when a source file is newer than the last build.
server="$root/dist/headroom"
if [ ! -f "$server" ] || [ -n "$(find "$root/apps/server" "$root/apps/web" "$root/packages" \
  "$root/bun.lock" "$root/package.json" "$root/scripts/build-server.ts" \
  \( -name node_modules -o -name dist \) -prune -o -type f -newer "$server" -print -quit)" ]; then
  (cd "$root" && mise exec -- bun run build)
fi
install -m 0755 "$server" "$built/Contents/Resources/headroom"

pkill -x Headroom || true
# Unregister every other copy: earlier installs, Debug builds and other worktrees.
"$lsregister" -dump | sed -n 's/^path: *\(.*Headroom\.app\) (0x[0-9a-f]*)$/\1/p' | sort -u |
  while IFS= read -r app; do
    [ "$app" = "$target" ] && continue
    pluginkit -r "$app/Contents/PlugIns/HeadroomWidgets.appex" 2>/dev/null || true
    "$lsregister" -u "$app" 2>/dev/null || true
    echo "unregistered $app"
  done

rm -rf "$target" "$old"
ditto "$built" "$target"
# The build output is a second copy of the same bundle. Remove it so it never registers again.
rm -rf "$built"
codesign --force --deep -s - --preserve-metadata=entitlements,identifier "$target"
"$target/Contents/Resources/headroom" --version >/dev/null
xattr -cr "$target"
"$lsregister" -f "$target"
pluginkit -a "$target/Contents/PlugIns/HeadroomWidgets.appex"
# chronod hosts widgets; launchd restarts it and it reloads the extension list.
killall chronod 2>/dev/null || true

open "$target"
# The copy above can register the bundle mid-copy through file events, without its icon.
# Register it once more now that it is complete.
"$lsregister" -f "$target"
echo "installed Headroom $version ($build)"
