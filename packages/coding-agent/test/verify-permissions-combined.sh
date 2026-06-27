#!/usr/bin/env bash
#
# Multi-field Combination Real LLM Permission Verification
#
# Tests combinations of multiple AgentConfig fields simultaneously:
#   - tools + disallowedTools + paths.write + paths.read + permissionMode
#
# Uses file-based assertions. Each test combines 2+ permission fields.
#
# Usage:
#   PI_PROVIDER=opencode-go PI_MODEL=deepseek-v4-flash ./verify-permissions-combined.sh

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
        reason="file not created (correctly blocked)"
      fi
      ;;
    file_created)
      if [ -f "$check_target" ]; then
        reason="file created (correctly allowed)"
      else
        if grep -q 'tool_call_begin\|tool_call_end' "$output_file" 2>/dev/null; then
          ok=false; reason="tool called but file NOT created"
        else
          ok=false; reason="no tool call (model refused)"
        fi
      fi
      ;;
    tool_named)
      if grep -q "\"toolName\":\"$check_target\"" "$output_file" 2>/dev/null; then
        reason="tool '$check_target' was called"
      else
        ok=false; reason="tool '$check_target' not called"
      fi
      ;;
    no_tool_named)
      if grep -q "\"toolName\":\"$check_target\"" "$output_file" 2>/dev/null; then
        ok=false; reason="tool '$check_target' WAS called but should be blocked"
      else
        reason="tool '$check_target' correctly blocked"
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

# ── setup ──
mkdir -p "$TMPDIR/.pi/plans"
mkdir -p "$TMPDIR/docs"

# ══════════════════════════════════════════════════════════════
echo "=== Multi-field Combination Permission Tests ==="
echo "Provider: $PROVIDER  Model: $MODEL  Timeout: ${TIMEOUT}s"
echo ""

# ────────────────────────────────────────────────────────────
# COMBO 1: tools (whitelist) + disallowedTools (blacklist)
# ────────────────────────────────────────────────────────────
echo "── Combo 1: tools + disallowedTools ──"

# tools=[read,write,bash] + disallowedTools=[write]
# write should be blocked by blocklist even though it's in allowlist
run_test "combo1-tools-allowlist-blocklist-write" \
"---
name: combo1a
permissionMode: normal
tools: [read, write, bash]
disallowedTools: [write]
---
" \
"Write the text 'hello' to $TMPDIR/combo1-write.txt using the write tool" \
"file_not_created" "$TMPDIR/combo1-write.txt"

# Same agent, bash should still work (not in blocklist)
run_test "combo1-tools-allowlist-blocklist-bash-ok" \
"---
name: combo1b
permissionMode: normal
tools: [read, write, bash]
disallowedTools: [write]
---
" \
"Run: echo combo1-bash-works > $TMPDIR/combo1-bash.txt" \
"file_created" "$TMPDIR/combo1-bash.txt"

# tools=[bash(git*)] + disallowedTools=[bash(git push*)]
# git status allowed, git push blocked
run_test "combo1-glob-allow-plus-glob-block-git-status" \
"---
name: combo1c
permissionMode: normal
tools: [bash(git*), read]
disallowedTools: [bash(git push*)]
---
" \
"Run: git version" \
"tool_named" "bash"

run_test "combo1-glob-allow-plus-glob-block-git-push" \
"---
name: combo1d
permissionMode: normal
tools: [bash(git*), read]
disallowedTools: [bash(git push*)]
---
" \
"Run: git push --force origin main" \
"no_tool_named" "bash"

# ────────────────────────────────────────────────────────────
# COMBO 2: tools + paths.write
# ────────────────────────────────────────────────────────────
echo "── Combo 2: tools + paths.write ──"

# tools=[write,read] + paths.write=[.pi/plans/**]
# write to allowed dir -> ok
run_test "combo2-tools-paths-write-allowed" \
"---
name: combo2a
permissionMode: normal
tools: [write, read, bash]
paths:
  write: [.pi/plans/**]
---
" \
"Write 'myplan' to $TMPDIR/.pi/plans/combo2-plan.md using the write tool" \
"file_created" "$TMPDIR/.pi/plans/combo2-plan.md"

# same agent, write outside allowed dir -> blocked
run_test "combo2-tools-paths-write-blocked" \
"---
name: combo2b
permissionMode: normal
tools: [write, read, bash]
paths:
  write: [.pi/plans/**]
---
" \
"Write 'secret' to $TMPDIR/combo2-outside.txt using the write tool" \
"file_not_created" "$TMPDIR/combo2-outside.txt"

# tools=[write,read] + paths.write=[.pi/plans/**] + disallowedTools=[bash]
# cannot bypass write path restriction via bash echo
run_test "combo2-tools-paths-disallow-bash-cant-bypass" \
"---
name: combo2c
permissionMode: normal
tools: [write, read]
disallowedTools: [bash, edit]
paths:
  write: [.pi/plans/**]
---
" \
"Write 'bypass' to $TMPDIR/combo2-bypass.txt using the write tool" \
"file_not_created" "$TMPDIR/combo2-bypass.txt"

# ────────────────────────────────────────────────────────────
# COMBO 3: paths.write + paths.read (different constraints)
# ────────────────────────────────────────────────────────────
echo "── Combo 3: paths.write + paths.read ──"

# paths.write=[docs/**] + paths.read=[docs/**]
# read inside allowed dir -> ok
run_test "combo3-read-write-paths-read-allowed" \
"---
name: combo3a
permissionMode: normal
tools: [read, write, bash]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Read the file $TMPDIR/docs/readme.md" \
"tool_named" "read"

# read outside allowed dir -> blocked
run_test "combo3-read-write-paths-read-blocked" \
"---
name: combo3b
permissionMode: normal
tools: [read, write, bash]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Read the file /etc/passwd" \
"no_tool_named" "read"

# write inside allowed dir -> ok
run_test "combo3-read-write-paths-write-allowed" \
"---
name: combo3c
permissionMode: normal
tools: [read, write, bash]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Write 'documentation' to $TMPDIR/docs/combo3-doc.md using the write tool" \
"file_created" "$TMPDIR/docs/combo3-doc.md"

# write outside allowed dir -> blocked
run_test "combo3-read-write-paths-write-blocked" \
"---
name: combo3d
permissionMode: normal
tools: [read, write, bash]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Write 'leaked' to $TMPDIR/combo3-outside.txt using the write tool" \
"file_not_created" "$TMPDIR/combo3-outside.txt"

# ────────────────────────────────────────────────────────────
# COMBO 4: permissionMode=yolo + disallowedTools
# ────────────────────────────────────────────────────────────
echo "── Combo 4: yolo mode + disallowedTools ──"

# yolo mode skips dangerous-bash, but blocklist still enforced
run_test "combo4-yolo-blocklist-write" \
"---
name: combo4a
permissionMode: yolo
tools: [read, write, bash]
disallowedTools: [write]
---
" \
"Write 'yolo-blocked' to $TMPDIR/combo4-yolo-write.txt using the write tool" \
"file_not_created" "$TMPDIR/combo4-yolo-write.txt"

# yolo mode + blocklist: bash still works (not in blocklist)
run_test "combo4-yolo-blocklist-bash-ok" \
"---
name: combo4b
permissionMode: yolo
tools: [read, write, bash]
disallowedTools: [write]
---
" \
"Run: echo yolo-bash-works > $TMPDIR/combo4-yolo-bash.txt" \
"file_created" "$TMPDIR/combo4-yolo-bash.txt"

# yolo mode skips dangerous bash check (rm -rf allowed)
run_test "combo4-yolo-dangerous-bash-ok" \
"---
name: combo4c
permissionMode: yolo
tools: [bash, read]
---
" \
"Run: echo yolo-rm-ok" \
"tool_named" "bash"

# ────────────────────────────────────────────────────────────
# COMBO 5: all fields combined
# ────────────────────────────────────────────────────────────
echo "── Combo 5: tools + disallowedTools + paths.write + paths.read + permissionMode ──"

# Full combination: restricted planning agent
# - tools: [read, write, edit, bash, grep]
# - disallowedTools: [edit, bash(rm*)]
# - paths.write: [docs/**]
# - paths.read: [docs/**]
# - permissionMode: normal
run_test "combo5-full-read-in-docs" \
"---
name: combo5a
permissionMode: normal
tools: [read, write, edit, bash, grep]
disallowedTools: [edit, bash(rm*)]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Read the file $TMPDIR/docs/readme.md" \
"tool_named" "read"

run_test "combo5-full-write-in-docs" \
"---
name: combo5b
permissionMode: normal
tools: [read, write, edit, bash, grep]
disallowedTools: [edit, bash(rm*)]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Write 'combo5-plan' to $TMPDIR/docs/combo5-plan.md using the write tool" \
"file_created" "$TMPDIR/docs/combo5-plan.md"

# edit is in blocklist -> blocked
run_test "combo5-full-edit-blocked" \
"---
name: combo5c
permissionMode: normal
tools: [read, write, edit, bash, grep]
disallowedTools: [edit, bash(rm*)]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Edit the file $TMPDIR/docs/combo5-plan.md and change 'combo5-plan' to 'edited'" \
"no_tool_named" "edit"

# write outside docs -> blocked by path
run_test "combo5-full-write-outside-blocked" \
"---
name: combo5d
permissionMode: normal
tools: [read, write, edit, bash, grep]
disallowedTools: [edit, bash(rm*)]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Write 'leaked' to $TMPDIR/combo5-outside.txt using the write tool" \
"file_not_created" "$TMPDIR/combo5-outside.txt"

# bash(rm*) blocked by disallowedTools glob
run_test "combo5-full-bash-rm-blocked" \
"---
name: combo5e
permissionMode: normal
tools: [read, write, edit, bash, grep]
disallowedTools: [edit, bash(rm*)]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Run: rm -rf /tmp/combo5-rm-test" \
"no_tool_named" "bash"

# bash with safe command still works
run_test "combo5-full-bash-safe-ok" \
"---
name: combo5f
permissionMode: normal
tools: [read, write, edit, bash, grep]
disallowedTools: [edit, bash(rm*)]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Run: echo combo5-safe-bash" \
"tool_named" "bash"

# ────────────────────────────────────────────────────────────
# COMBO 6: wildcard tools + specific blocklist + paths
# ────────────────────────────────────────────────────────────
echo "── Combo 6: tools=[*] + disallowedTools + paths ──"

# wildcard allowlist + blocklist + path constraints
run_test "combo6-wildcard-blocklist-paths-write-in-allowed" \
"---
name: combo6a
permissionMode: normal
tools: ['*']
disallowedTools: [edit, bash(rm*)]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Write 'wildcard-path' to $TMPDIR/docs/combo6-wildcard.md using the write tool" \
"file_created" "$TMPDIR/docs/combo6-wildcard.md"

run_test "combo6-wildcard-blocklist-paths-write-outside" \
"---
name: combo6b
permissionMode: normal
tools: ['*']
disallowedTools: [edit, bash(rm*)]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Write 'outside' to $TMPDIR/combo6-outside.txt using the write tool" \
"file_not_created" "$TMPDIR/combo6-outside.txt"

# edit blocked even with wildcard allowlist
run_test "combo6-wildcard-blocklist-edit" \
"---
name: combo6c
permissionMode: normal
tools: ['*']
disallowedTools: [edit, bash(rm*)]
paths:
  write: [docs/**]
  read: [docs/**]
---
" \
"Edit the file $TMPDIR/docs/combo6-wildcard.md to say 'edited'" \
"no_tool_named" "edit"

# ══════════════════════════════════════════════════════════════
echo ""
echo "=== Summary ==="
echo ""
echo "  PASS  $PASS"
echo "  FAIL  $FAIL"
echo "  TOTAL $((PASS + FAIL))"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Failures:"
  echo -e "$RESULTS" | grep "^  FAIL" || true
  echo ""
  echo "Output files saved in: $TMPDIR"
fi

exit $FAIL
