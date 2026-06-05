# Rules Engine: MatchHistory Staleness Scenarios & Reconciliation

## Problem

Conditional rule matches are tracked in `matchHistory` (an array of `MatchRecord`).
The history can become **stale** when messages that triggered matches are removed or modified
without an explicit notification to the rules-engine plugin.

## Scenarios

### 1. Context Compaction

**What happens**: pi compacts old messages into a summary. ToolResult messages
that contained `details.rulesMatched` are replaced by a compact summary entry.

**Signal**: `session_compact` event fires. Plugin resets `cachedMatchHash` and clears `lastMessages`.

**Reconciliation**:
- `context` event fires on the next agent turn with the **post-compaction** message list
- `rebuildMatchHistory()` scans remaining messages — compacted-away matches disappear
- `turn_end` also checks for drift and sends corrected snapshot if needed

**Result**: Matched rules from compacted-away messages are automatically cleared.

### 2. Rollback / Abort Retry

**What happens**: User triggers abort_retry, which removes the last assistant turn
including its tool results. Previously matched rules are no longer in context.

**Signal**: No explicit event. The rolled-back messages are removed from the message list.

**Reconciliation**:
- `context` event fires on the next agent turn — rolled-back messages are absent
- `rebuildMatchHistory()` only finds matches in remaining messages
- `turn_end` catches this too

**Result**: Stale. Panel may show old matches until next agent turn or manual `requestSnapshot`.

### 3. Manual Message Deletion

**What happens**: User manually deletes a message (e.g., via UI). If the deleted message
was a toolResult with `details.rulesMatched`, the match is no longer valid.

**Signal**: No event at all.

**Reconciliation**:
- Same as rollback: `context` and `turn_end` eventually reconcile
- Frontend `requestSnapshot` (on panel open/refresh) triggers `rebuildMatchHistory(lastMessages)`
- But `lastMessages` may be stale if no `context` event fired since deletion

**Result**: Stale until next agent turn or `requestSnapshot` with fresh context.

### 4. Other Plugin Modifies/Hides Tool Results

**What happens**: Another plugin (e.g., todo-cleanup) hides or modifies a toolResult entry,
removing its `details.rulesMatched` field or replacing the message entirely.

**Signal**: No cross-plugin notification.

**Reconciliation**:
- `context` event sees the modified messages and rebuilds accordingly
- If the other plugin modifies messages between `context` events, stale data persists

**Result**: Same as deletion — eventually consistent after next `context`.

### 5. Session Fork / Switch

**What happens**: Session is forked or user switches to a different session. The forked
session has a copy of messages, but the rules-engine state is per-process.

**Signal**: `session_start` fires for the new session. Plugin sends fresh snapshot.

**Reconciliation**:
- New pi process → fresh state → `session_start` sends snapshot with empty history
- `context` event rebuilds from the forked messages
- Any matches present in the forked messages will be picked up

**Result**: Correct — matches from the fork are preserved, new matches start fresh.

## Reconciliation Mechanism Summary

| Mechanism | Trigger | Uses Fresh Data? | Cost |
|-----------|---------|------------------|------|
| `context` event | Every agent turn (before LLM call) | Yes (current messages) | Medium — scans all messages |
| `turn_end` event | End of every turn | Yes (cached `lastMessages`) | Low — hash comparison + conditional snapshot |
| `requestSnapshot` RPC | Frontend panel open/refresh | Yes (cached `lastMessages`) | Low — only when user requests |
| `session_compact` | After compaction | Clears cache → forces rebuild | Negligible |

## Latency Analysis

The `context` event fires via `transformContext` in the agent loop (`packages/agent/agent-loop.ts:145-146`),
called **before every LLM call**. This is the primary reconciliation point.

**Latency gap**: Between a message mutation (rollback, deletion, compaction) and the next LLM call,
the panel may show stale data. This is acceptable because:

1. Users rarely watch the rules panel during message mutations
2. Next agent turn reconciles immediately (sub-second)
3. `requestSnapshot` (panel open/refresh) uses `lastMessages` which is at most one turn stale
4. No event exists for message deletion in the pi extension API — polling would be the only alternative

**Why not poll?** Periodic `requestSnapshot` would require fresh messages (not cached), which means
calling into the agent state on a timer. The `context` event already provides this for free on every turn.

## Implementation Notes

- `rebuildMatchHistory()` is the single source of truth — shared by `context`, `turn_end`, and `requestSnapshot`
- `lastMessages` is cached from the most recent `context` event
- `cachedMatchHash` is used to avoid sending duplicate snapshots when nothing changed
- Frontend merges `matchHistory` on snapshot (doesn't wipe on empty) to survive between reconciliations
- All 5 scenarios are **eventually consistent** with at most one-turn latency — no additional mechanism needed
