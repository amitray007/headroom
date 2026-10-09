#!/usr/bin/env bash
# Smoke-test a compiled Headroom binary: version, help, then start it and fetch /healthz and /.
# Usage: scripts/smoke-binary.sh <binary> <expected-version>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <binary> <expected-version>" >&2
  exit 2
fi

binary=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
expected=$2
[[ -x "$binary" ]] || { echo "not executable: $binary" >&2; exit 2; }

work=$(mktemp -d)
log="$work/server.log"
pid=""

cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "smoke test failed: $1" >&2
  if [[ -s "$log" ]]; then
    echo "--- server log ---" >&2
    cat "$log" >&2
    echo "--- end of log ---" >&2
  fi
  exit 1
}

# The binary runs with a throwaway HOME so it never touches the real per-user directories.
export HOME="$work/home"
mkdir -p "$HOME"
export HEADROOM_DATA_DIR="$work/data"
export HEADROOM_MASTER_KEY_FILE="$work/secrets/master.key"
export HEADROOM_AUTH_SECRET_FILE="$work/secrets/auth.secret"

out=$("$binary" --version) || fail "--version exited non-zero"
[[ "$out" == "headroom $expected" ]] || fail "--version printed '$out', expected 'headroom $expected'"
echo "version ok: $out"

"$binary" --help >/dev/null || fail "--help exited non-zero"
echo "help ok"

if command -v python3 >/dev/null 2>&1; then
  port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
else
  port=$((20000 + RANDOM % 20000))
fi

"$binary" start --port "$port" >"$log" 2>&1 &
pid=$!

health=""
for _ in $(seq 1 40); do
  kill -0 "$pid" 2>/dev/null || fail "server exited before it answered /healthz"
  if health=$(curl -fsS "http://127.0.0.1:$port/healthz" 2>/dev/null); then
    break
  fi
  health=""
  sleep 0.5
done
[[ -n "$health" ]] || fail "no answer from /healthz within 20 seconds"
echo "healthz: $health"
[[ "$health" == *"\"version\":\"$expected\""* ]] || fail "/healthz version is not $expected"

page=$(curl -fsS -H 'Accept: text/html' "http://127.0.0.1:$port/") || fail "GET / failed"
[[ "$page" == *'<div id="root">'* ]] || fail "GET / did not return the web UI page"
echo "web UI ok"

echo "smoke test passed"
