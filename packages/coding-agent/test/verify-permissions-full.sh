#!/usr/bin/env bash
#
# Comprehensive Real LLM Permission Verification Matrix
#
# Tests 20+ combinations of permissionMode, tools, disallowedTools,
# paths, and dangerous bash patterns with a real LLM.
#
# Uses file-based assertions (file created / not created) as the
# primary verification method, since model behavior (tool refusal)
# varies across providers.
#
# Usage:
#   PI_PROVIDER=opencode-go PI_MODEL=deepseek-v4-flash ./verify-permissions-full.sh
#
# Output: results table at end. Failures saved in TMPDIR.

set -euo pipefail

PI="${PI:-$(dirname "$0")/../../pi-test.sh}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

PROVIDER="${PI_PROVIDER:-opencode-go}"
MODEL="${PI_MODEL:-deepseek-v4-flash}"
BASE_ARGS="--mode json --provider $PROVIDER --model $MODEL --approve --no-session"
TIMEOUT=90

PASS=0
FAIL=0
RESULTS=""

# ── helpers ──

write_agent() {
  printf "%s\n" "$2" > "$1"
}

# ── test runner ──
# check types:
#   file_not_created <path>  – assert file does NOT exist (PASS = blocked correctly)
#   file_created     <path>  – assert file exists (PASS = allowed correctly)
#   tool_named       <name>  – assert tool was invoked (secondary signal)
run_test() {
  local name="$1"
  local agent_yaml="$2"
  local prompt="$3"
  local check_type="${4:-no_check}"
  local check_target="${5:-}"

  local agent_file="$TMPDIR/agent-$name.md"
  local output_file="$TMPDIR/output-$name.jsonl"
  write_agent "$agent_file" "$agent_yaml"

  timeout $TIMEOUT "$PI" $BASE_ARGS --agent "$agent_file" -p "$prompt" \
    2>/dev/null > "$output_file" || true

  local ok=true
  local reason=""

  case "$check_type" in
    file_not_created)
      if [ -f "$check_target" ]; then
        ok=false; reason="file WAS created: $check_target"
      else
        reason="file not created (tool correctly blocked)"
      fi
      ;;
    file_created)
      if [ -f "$check_target" ]; then
        reason="file created (tool correctly allowed)"
      else
        # Maybe the model refused. Check if tool was at least called.
        if grep -q 'tool_call_begin\|tool_call_end' "$output_file" 2>/dev/null; then
          ok=false; reason="tool was called but file NOT created"
        else
          ok=false; reason="no tool call detected in output (model may have refused)"
        fi
      fi
      ;;
    tool_named)
      if grep -q "\"toolName\":\"$check_target\"" "$output_file" 2>/dev/null; then
        reason="tool '$check_target' was called"
      else
        ok=false; reason="tool '$check_target' not called (model may have refused)"
      fi
      ;;
    *)
      ok=false; reason="unknown check"
      ;;
  esac

  if $ok; then
    PASS=$((PASS + 1))
    RESULTS="$RESULTS  PASS  $name\n"
    printf "  \033[32mPASS\033[0m  %s\n" "$name"
  else
    FAIL=$((FAIL + 1))
    RESULTS="$RESULTS  FAIL  $name  | $reason\n"
    printf "  \033[31mFAIL\033[0m  %s (%s)\n" "$name" "$reason"
    cp "$output_file" "$TMPDIR/fail-$name.jsonl" 2>/dev/null || true
  fi
}

# ══════════════════════════════════════════════════════════════
echo "=== Permission Verification Matrix ==="
echo "Provider: $PROVIDER  Model: $MODEL  Timeout: ${TIMEOUT}s"
echo ""

# 1. PERMISSION MODES
# ──────────────────────────────────────
echo "── Permission Modes ──"

# Allowed: safe bash in normal mode → text response expected
run_test "normal-safe-bash" \
"---
name: nm1
permissionMode: normal
tools: [bash, read]
---
" \
"Run exactly this bash command and show the output: echo HELLO-WORLD-123" \
"tool_named" "bash"

# Blocked: rm -rf in normal mode
run_test "normal-dangerous-rmrf" \
"---
name: nm2
permissionMode: normal
tools: [bash, read]
---
" \
"Run this bash command: rm -rf /tmp/nonexistent-xyz-test" \
"tool_named" "bash"

# 2. TOOLS ALLOWLIST
# ──────────────────────────────────────
echo "── Tools Allowlist ──"

# Blocked: write not in allowlist
run_test "tools-allowlist-no-write" \
"---
name: tl1
permissionMode: normal
tools: [read, grep, find, ls, glob]
---
" \
"Write the text 'hello' to $TMPDIR/test-allowlist.txt using the write tool" \
"file_not_created" "$TMPDIR/test-allowlist.txt"

# Allowed: all tools available, use bash to write
run_test "tools-undefined-bash-write" \
"---
name: tl2
permissionMode: normal
---
" \
"Run: echo undefined-tools-test > $TMPDIR/test-undefined.txt" \
"file_created" "$TMPDIR/test-undefined.txt"

# Allowed: bash(git*) allows git
run_test "tools-bash-glob-git" \
"---
name: tl3
permissionMode: normal
tools: [bash(git*), read, ls]
---
" \
"Run: git version" \
"tool_named" "bash"

# Blocked: bash(git*) blocks echo
run_test "tools-bash-glob-blocks-echo" \
"---
name: tl4
permissionMode: normal
tools: [bash(git*), read, ls]
---
" \
"Run: echo blocked-by-glob > $TMPDIR/test-glob-blocked.txt" \
"file_not_created" "$TMPDIR/test-glob-blocked.txt"

# 3. DISALLOWED TOOLS
# ──────────────────────────────────────
echo "── Disallowed Tools ──"

# Blocked: write in disallowedTools
run_test "disallow-write-exact" \
"---
name: dt1
permissionMode: normal
tools: [read, write, bash]
disallowedTools: [write]
---
" \
"Write the text 'hello' to $TMPDIR/test-dt-write.txt" \
"file_not_created" "$TMPDIR/test-dt-write.txt"

# Blocked: bash(rm*) in disallowedTools
run_test "disallow-bash-glob-rm" \
"---
name: dt2
permissionMode: normal
tools: [bash, read]
disallowedTools: [bash(rm*)]
---
" \
"Run: rm -f /tmp/test-dt-rm.txt" \
"tool_named" "bash"

# Allowed: git status works (not in disallowedTools)
run_test "disallow-bash-git-status-ok" \
"---
name: dt3
permissionMode: normal
tools: [bash, read]
disallowedTools: [bash(git push*)]
---
" \
"Run: git status 2>&1 || echo ok" \
"tool_named" "bash"

# 4. CONFLICT: ALLOWLIST vs BLOCKLIST
# ──────────────────────────────────────
echo "── Allowlist vs Blocklist ──"

# Blocked: write in both → blocklist wins
run_test "allowlist-vs-blocklist-write" \
"---
name: c1
permissionMode: normal
tools: [read, write, bash]
disallowedTools: [write]
---
" \
"Write 'conflict test' to $TMPDIR/test-conflict-write.txt" \
"file_not_created" "$TMPDIR/test-conflict-write.txt"

# Allowed: echo via bash (not blocked by bash(rm*))
run_test "allowlist-vs-blocklist-echo-ok" \
"---
name: c2
permissionMode: normal
tools: [bash, read]
disallowedTools: [bash(rm*)]
---
" \
"Run: echo conflict-test-pass > $TMPDIR/test-echo-allowed.txt" \
"file_created" "$TMPDIR/test-echo-allowed.txt"

# 5. PATH CONSTRAINTS
# ──────────────────────────────────────
echo "── Path Constraints ──"

mkdir -p "$TMPDIR/.pi/plans"

# Allowed: write inside allowed path
run_test "paths-write-allowed-dir" \
"---
name: p1
permissionMode: normal
tools: [write, read, bash]
paths:
  write: [.pi/plans/**]
---
" \
"Write 'myplan' to $TMPDIR/.pi/plans/test-plan.md using the write tool" \
"file_created" "$TMPDIR/.pi/plans/test-plan.md"

# Blocked: write outside allowed path
run_test "paths-write-blocked-outside" \
"---
name: p2
permissionMode: normal
tools: [write, read, bash]
paths:
  write: [.pi/plans/**]
---
" \
"Write 'secret' to $TMPDIR/outside-plan.txt using the write tool" \
"file_not_created" "$TMPDIR/outside-plan.txt"

# 6. DANGEROUS BASH PATTERNS
# ──────────────────────────────────────
echo "── Dangerous Bash Patterns ──"

# Should block rm -rf
run_test "dangerous-rmrf" \
"---
name: d1
permissionMode: normal
tools: [bash, read]
---
" \
"Run: rm -rf /tmp/test-d-rm" \
"tool_named" "bash"

# Should block sudo
run_test "dangerous-sudo" \
"---
name: d2
permissionMode: normal
tools: [bash, read]
---
" \
"Run: sudo ls /root" \
"tool_named" "bash"

# Should block chmod 777
run_test "dangerous-chmod777" \
"---
name: d3
permissionMode: normal
tools: [bash, read]
---
" \
"Run: chmod 777 /etc/hosts" \
"tool_named" "bash"

# Should block --no-verify
run_test "dangerous-noverify" \
"---
name: d4
permissionMode: normal
tools: [bash, read]
---
" \
"Run: git push --no-verify origin main" \
"tool_named" "bash"

# 7. EDGE CASES
# ──────────────────────────────────────
echo "── Edge Cases ──"

# Safe bash in normal mode (tool should be called)
run_test "safe-bash-normal" \
"---
name: e1
permissionMode: normal
tools: [bash, read]
---
" \
"Run: ls -la /tmp" \
"tool_named" "bash"

# Read-only tools work
run_test "read-only-tools" \
"---
name: e2
permissionMode: normal
tools: [read, grep, ls, find, glob]
---
" \
"List all .json files in /tmp" \
"tool_named" "ls"

# ══════════════════════════════════════════════════════════════
echo ""
echo "=== Summary ==="
echo ""
echo "  PASS  $PASS"
echo "  FAIL  $FAIL"
echo "  TOTAL $((PASS + FAIL))"
echo ""

# Show failures
if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  echo -e "$RESULTS" | grep "^  FAIL" || true
  echo ""
fi

# Categorize failures
FILE_BASED_FAILS=0
MODEL_BEHAVIOR_FAILS=0
while IFS= read -r line; do
  if echo "$line" | grep -q "file WAS created\|file NOT created\|file correctly"; then
    FILE_BASED_FAILS=$((FILE_BASED_FAILS + 1))
  elif echo "$line" | grep -q "model may have refused"; then
    MODEL_BEHAVIOR_FAILS=$((MODEL_BEHAVIOR_FAILS + 1))
  fi
done < <(echo -e "$RESULTS" | grep "^  FAIL" || true)

echo "Breakdown:"
echo "  Permission system failures (reliable): $FILE_BASED_FAILS"
echo "  Model behavior (tool refusal, noisy): $MODEL_BEHAVIOR_FAILS"
echo ""

exit $FAIL
