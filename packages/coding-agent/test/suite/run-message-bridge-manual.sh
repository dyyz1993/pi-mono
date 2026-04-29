#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TSX_BIN="$REPO_DIR/node_modules/.bin/tsx"

if [[ ! -x "$TSX_BIN" ]]; then
  echo "tsx not found at $TSX_BIN" >&2
  exit 1
fi

echo "========================================="
echo "  Message Bridge Manual E2E Test"
echo "========================================="
echo ""
echo "  Bridge:  ${MESSAGE_BRIDGE_URL:-https://message-bridge.docker.19930810.xyz:8443}"
echo "  Session: ${MESSAGE_BRIDGE_SESSION_ID:-pi-manual-test}"
echo ""
echo "  Flow:"
echo "    1. Agent triggers ctx.ui.confirm() → pushed to Bridge"
echo "    2. Script hangs, waiting for YOUR manual reply"
echo "    3. You reply via Bridge web/mobile UI"
echo "    4. Agent continues, finishes"
echo "    5. agent_end pushes final text to Bridge"
echo "    6. You reply again → sendUserMessage triggers new agent turn"
echo ""
echo "  Press Ctrl+C to stop"
echo "========================================="
echo ""

export MESSAGE_BRIDGE_URL="${MESSAGE_BRIDGE_URL:-https://message-bridge.docker.19930810.xyz:8443}"
export MESSAGE_BRIDGE_SESSION_ID="${MESSAGE_BRIDGE_SESSION_ID:-pi-manual-test}"

"$TSX_BIN" "$SCRIPT_DIR/run-message-bridge-manual.ts"
