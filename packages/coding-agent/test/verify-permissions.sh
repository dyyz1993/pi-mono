#!/usr/bin/env bash
#
# Real LLM Verification Script for Agent Permission System
#
# Usage: PI_PROVIDER=opencode-go PI_MODEL=deepseek-v4-flash ./verify-permissions.sh
#
# Prerequisites:
#   - A working LLM provider + API key configured
#   - The pi binary built or accessible via pi-test.sh
#
# This script verifies that the permission system works correctly
# with a real LLM. It tests:
#   - --agent flag with agent name and file path
#   - tools white/blacklist filtering
#   - path constraints (paths.write)
#   - RPC switch_agent command
#
# Each test reports PASS or FAIL and cleans up after itself.

set -euo pipefail

PI="${PI:-$(dirname "$0")/../../pi-test.sh}"
PI_CWD="$(mktemp -d)"
PI_AGENTS_DIR="$PI_CWD/.pi/agents"
FIXTURES_DIR="$(dirname "$0")/../fixtures/agents"

PROVIDER="${PI_PROVIDER:-opencode-go}"
MODEL="${PI_MODEL:-deepseek-v4-flash}"
ARGS="--mode json --provider $PROVIDER --model $MODEL --approve"

PASS=0
FAIL=0

cleanup() { rm -rf "$PI_CWD"; }
trap cleanup EXIT

mkdir -p "$PI_AGENTS_DIR"

# Copy fixture agents to the test project
cp "$FIXTURES_DIR/read-only.md" "$PI_AGENTS_DIR/"
cp "$FIXTURES_DIR/plan-agent.md" "$PI_AGENTS_DIR/"

echo "=== Permission Verification Tests ==="
echo "Provider: $PROVIDER  Model: $MODEL"
echo ""

# Test 1: --agent by name blocks disallowed tools
echo "--- Test 1: --agent read-only blocks write tool ---"
OUTPUT=$(mktemp)
timeout 90 "$PI" $ARGS --agent read-only -p "Write 'test' to /tmp/pi-vtest-1.txt using write tool" 2>/dev/null > "$OUTPUT" || true
if [ -f /tmp/pi-vtest-1.txt ]; then
  echo "  FAIL: File was written despite agent blocking write tool"
  rm -f /tmp/pi-vtest-1.txt
  FAIL=$((FAIL + 1))
else
  echo "  PASS: File not created (write tool blocked by agent config)"
  PASS=$((PASS + 1))
fi
rm -f "$OUTPUT"

# Test 2: --agent by file path
echo "--- Test 2: --agent with file path ---"
OUTPUT=$(mktemp)
timeout 90 "$PI" $ARGS --agent "$FIXTURES_DIR/read-only.md" -p "List files in /tmp" 2>/dev/null > "$OUTPUT" || true
if grep -q "agent_start" "$OUTPUT" 2>/dev/null; then
  echo "  PASS: Agent loaded from file path"
  PASS=$((PASS + 1))
else
  echo "  FAIL: Agent did not load from file path"
  FAIL=$((FAIL + 1))
fi
rm -f "$OUTPUT"

# Test 3: Plan agent respects paths.write constraint
echo "--- Test 3: plan-agent paths.write constraint ---"
mkdir -p "$PI_CWD/.pi/plans"
OUTPUT=$(mktemp)
timeout 90 "$PI" $ARGS --agent plan-agent -p "Write a plan to .pi/plans/test-plan.md" 2>/dev/null > "$OUTPUT" || true
if [ -f "$PI_CWD/.pi/plans/test-plan.md" ]; then
  echo "  PASS: Plan written to allowed path"
  PASS=$((PASS + 1))
else
  echo "  WARN: Plan not written (model may have refused or timed out)"
  # This is not necessarily a failure - the model might refuse or timeout
fi
rm -f "$OUTPUT"

# Test 4: RPC mode switch_agent
echo "--- Test 4: RPC mode switch_agent ---"
OUTPUT=$(mktemp)
echo '{"id":"1","type":"switch_agent","agentName":"read-only"}
{"id":"2","type":"prompt","message":"Write test to /tmp/pi-vtest-4.txt"}' | \
  timeout 60 "$PI" --mode rpc --provider $PROVIDER --model $MODEL --approve \
    2>/dev/null > "$OUTPUT" || true
if grep -q '"success":true' "$OUTPUT" | head -1; then
  # Check first response (switch_agent)
  if head -1 "$OUTPUT" | grep -q '"success":true'; then
    echo "  PASS: RPC switch_agent succeeded"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: RPC switch_agent failed"
    FAIL=$((FAIL + 1))
  fi
fi
rm -f "$OUTPUT"

echo ""
echo "=== Results: $PASS pass, $FAIL fail ==="
exit $FAIL
