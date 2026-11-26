#!/usr/bin/env bash
# Package an already-built universal app without Finder automation.
set -euo pipefail

if [ "$(uname -s)" != Darwin ]; then
  echo "This command requires macOS." >&2
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
version="$(node -p 'require("./package.json").version')"
node scripts/check-release-version.mjs "v$version"
bundle="$root/src-tauri/target/universal-apple-darwin/release/bundle"
app="$bundle/macos/CivicFlow.app"
plist="$app/Contents/Info.plist"
output="$bundle/dmg/CivicFlow_${version}_universal_evaluation.dmg"

if [ ! -f "$plist" ]; then
  echo "Build the universal application first with pnpm tauri build --target universal-apple-darwin --bundles app." >&2
  exit 1
fi

binary="$app/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
app_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")"
test "$app_version" = "$version"
lipo "$binary" -verify_arch arm64 x86_64
codesign --verify --deep --strict "$app"

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/payload" "$(dirname "$output")"
ditto "$app" "$scratch/payload/CivicFlow.app"
ln -s /Applications "$scratch/payload/Applications"
hdiutil create -format UDZO -volname "CivicFlow Evaluation" \
  -srcfolder "$scratch/payload" "$scratch/CivicFlow.dmg"
hdiutil verify "$scratch/CivicFlow.dmg"
mv -f "$scratch/CivicFlow.dmg" "$output"
shasum -a 256 "$output"
printf 'Evaluation DMG: %s\n' "$output"
