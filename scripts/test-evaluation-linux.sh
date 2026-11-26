#!/usr/bin/env bash
set -euo pipefail
[[ "${CI:-}" == true && "$(uname -s)" == Linux ]] || { echo "CI Linux only"; exit 2; }
package="$1"
test -f "$package"
scratch="$(mktemp -d)"
pkg="$(dpkg-deb -f "$package" Package)"
pid=""
cleanup() {
  if [[ -n "$pid" ]]; then kill -- "-$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  sudo apt-get remove -y "$pkg" || true
  rm -rf "$scratch"
}
trap cleanup EXIT
sudo apt-get install -y "$(realpath "$package")"
binary="$(dpkg -L "$pkg" | grep -E '^/usr/bin/[^/]+$' | head -n 1)"
test -x "$binary"
export CIVICFLOW_DATA_DIR="$scratch/workspace"
export CIVICFLOW_WORKSPACE_KEY="$(printf '%064d' 0)"
setsid xvfb-run -a dbus-run-session -- "$binary" > "$scratch/startup.log" 2>&1 &
pid=$!
for attempt in $(seq 1 60); do
  if ! kill -0 "$pid" 2>/dev/null; then cat "$scratch/startup.log"; exit 1; fi
  if [[ -s "$CIVICFLOW_DATA_DIR/civicflow.db" ]]; then break; fi
  sleep 1
done
test -s "$CIVICFLOW_DATA_DIR/civicflow.db"
if [[ "$(head -c 15 "$CIVICFLOW_DATA_DIR/civicflow.db" | od -An -tx1 | tr -d ' \n')" == 53514c69746520666f726d61742033 ]]; then
  echo "Unexpected plaintext workspace"; exit 1
fi
sleep 5
kill -0 "$pid"
echo "PASS: Debian package installed, launched and initialized an encrypted workspace."
