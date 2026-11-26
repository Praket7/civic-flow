#!/usr/bin/env bash
# Exercise the actual packaged application on a disposable CI runner.
set -euo pipefail
[[ "${CI:-}" == true && "$(uname -s)" == Darwin ]] || { echo "CI macOS only"; exit 2; }
dmg="$1"
test -f "$dmg"
scratch="$(mktemp -d)"
mount="$scratch/mount"
pid=""
mounted=0
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  if [[ "$mounted" == 1 ]]; then hdiutil detach "$mount" -quiet || hdiutil detach "$mount" -force -quiet; fi
  rm -rf "$scratch"
}
trap cleanup EXIT
mkdir "$mount"
hdiutil verify "$dmg"
hdiutil attach "$dmg" -readonly -nobrowse -mountpoint "$mount" -quiet
mounted=1
ditto "$mount/CivicFlow.app" "$scratch/CivicFlow.app"
app="$scratch/CivicFlow.app"
codesign --verify --deep --strict "$app"
binary="$app/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
lipo "$binary" -verify_arch arm64 x86_64
export CIVICFLOW_DATA_DIR="$scratch/workspace"
export CIVICFLOW_WORKSPACE_KEY="$(printf '%064d' 0)"
"$binary" > "$scratch/startup.log" 2>&1 &
pid=$!
for attempt in $(seq 1 45); do
  if ! kill -0 "$pid" 2>/dev/null; then cat "$scratch/startup.log"; echo "Installed app exited during startup"; exit 1; fi
  if [[ -s "$CIVICFLOW_DATA_DIR/civicflow.db" ]]; then break; fi
  sleep 1
done
test -s "$CIVICFLOW_DATA_DIR/civicflow.db"
# The encrypted workspace must not have a plaintext SQLite header.
if [[ "$(head -c 15 "$CIVICFLOW_DATA_DIR/civicflow.db" | od -An -tx1 | tr -d ' \n')" == 53514c69746520666f726d61742033 ]]; then
  echo "Unexpected plaintext workspace"; exit 1
fi
sleep 5
kill -0 "$pid"
echo "PASS: mounted verified universal DMG, copied app, launched installed binary, initialized encrypted workspace and remained running."
