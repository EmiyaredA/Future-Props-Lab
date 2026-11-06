#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Usage: scripts/website/build_remote_apps.sh /absolute/path/FPLRemoteApps.app' >&2
  exit 2
fi
case "$1" in
  /*.app) app="$1" ;;
  *) printf '%s\n' 'Output must be an absolute .app path.' >&2; exit 2 ;;
esac
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
source="$root/backend/studio/host/remote_apps"
bin="$app/Contents/MacOS"
mkdir -p "$bin"
(
  cd "$source/webrtc"
  CGO_ENABLED=0 go build -mod=readonly -trimpath -o "$bin/fpl-remote-apps" .
)
swiftc -swift-version 6 -O -module-cache-path "$root/.local/remote-apps/swift-cache" \
  -target "$(uname -m)-apple-macosx14.0" \
  "$source"/native/*.swift -o "$bin/fpl-window-capture"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>lab.futureprops.remoteapps</string>
  <key>CFBundleName</key><string>FPL Remote Apps</string>
  <key>CFBundleExecutable</key><string>fpl-window-capture</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
identity=${FPL_REMOTE_APPS_SIGNING_IDENTITY:--}
codesign --force --sign "$identity" "$bin/fpl-remote-apps"
codesign --force --sign "$identity" "$app"
codesign --verify --deep --strict "$app"
printf '%s\n' "$bin/fpl-remote-apps"
