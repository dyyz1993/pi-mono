# Rollback Data Reading Guide

This document describes how frontend consumers and extension developers should
read user-facing data after a rollback (tree navigation). It covers the two data
access APIs, their differences, and the complete data flow from rollback trigger
to user-visible messages.

## Quick Reference: Which API Should I Use?

| Scenario | API | Returns |
|---|---|---|
| Render chat messages (simple) | `get_messages` | `AgentMessage[]` — flat list, no entry IDs |
| Render chat messages (with tree, pagination, deletion) | `get_full_messages` | Paginated messages + tree structure + custom entries |
| Preview files affected by rollback | `rollback_preview` | `{ restored, deleted, skipped, dirty, forceRestored }` |
| List all changed files | `get_modified_files` | `ModifiedFile[]` with path, status, entryId |
| Get diff for a specific file | `get_file_diff` | `{ oldContent, newContent }` |
| Execute rollback | `navigate_tree` | `{ cancelled, editorText, newLeafId, reason }` |

## Data Flow: What Happens During Rollback

When `navigate_tree` is called (either via RPC or internally), the following
steps execute in order:

```
1. navigateTree(targetId, options)
   │
   ├─ 2. Safety check: if skipFiles !== true and path has 0 user messages → BLOCK
   │
   ├─ 3. Move leaf pointer
   │   ├─ target is user message → leaf = null (root navigation)
   │   ├─ summarize=true → branchWithSummary(targetId, summaryText)
   │   └─ otherwise → branch(targetId) or resetLeaf()
   │
   ├─ 4. Rebuild messages  ← THIS IS THE KEY STEP
   │   sessionContext = sessionManager.buildSessionContext()
   │   agent.state.messages = sessionContext.messages
   │
   ├─ 5. Restore files (if skipFiles !== true)
   │   fileSnapshotManager.restoreFiles(cwd, { targetEntryId, entries })
   │
   └─ 6. Emit session_tree event
       newLeafId, oldLeafId → extensions notified
```

After step 4, `session.messages` already reflects the post-rollback state.
Steps 5-6 are side effects (file changes + event notification).

## buildSessionContext: How Messages Are Rebuilt

`buildSessionContext()` traverses from the current leaf to root, collecting
entries along the path. It applies these transformations:

1. **Compaction entries**: If a `CompactionEntry` is on the path, messages
   before `firstKeptEntryId` are replaced by the compaction summary. Only the
   latest compaction on the path is used.

2. **Branch summary entries**: A `BranchSummaryEntry` is converted to a
   `BranchSummaryMessage` — a user-role message containing the summary text.

3. **Filtering**: Only `message` entries on the leaf-to-root path are included.
   Entries on abandoned branches are never visited.

**Key property**: The output is deterministic given the same leaf position.
No guessing, no fallbacks.

## User View vs Internal Data

### What the user sees (after rollback)

`session.messages` / `get_messages` returns only:
- Messages on the **current branch** (leaf to root path)
- Compaction summaries (if applicable)
- No traces of abandoned branches

### What the tree stores internally

`sessionManager.getEntries()` contains **everything**:
- All branches (including abandoned ones)
- `step-snapshot` entries (file tree hashes per turn)
- `unrevert-point` entries (pre-rollback file state)
- `file-approval` entries (file-review extension state)
- `deletion` and `segment_summary` entries
- All historical messages across all branches

This data is **append-only**. Rollback never deletes entries — it only moves
the leaf pointer. Old branch data persists for potential future navigation.

## get_messages vs get_full_messages

### get_messages (Simple)

```typescript
// RPC client
const messages = await rpcClient.getMessages();
// Returns: AgentMessage[]
```

Directly returns `agent.state.messages` — the output of `buildSessionContext()`.
No entry IDs, no tree structure, no pagination.

**Use when**: You need the current message list for LLM context or simple
display. This is what the agent itself uses.

### get_full_messages (Complete)

```typescript
// RPC client
const result = await rpcClient.getFullMessages({
  afterEntryId: "entry-123",  // optional: forward pagination
  beforeEntryId: "entry-456", // optional: backward pagination
  limit: 50,                  // optional: page size
});
// Returns:
// {
//   messages: RpcAgentMessage[],    // with entryId field
//   hasMore: boolean,
//   totalCount: number,
//   nextCursor: string | null,
//   tree: { entries: TreeEntry[], leafId: string | null },
//   customEntries: CustomEntry[],
//   compactionEntries: CompactionEntry[],
// }
```

Rebuilds from `sessionManager.getBranch()` with additional processing:
- Filters out messages targeted by `deletion` entries
- Replaces messages targeted by `segment_summary` entries with summaries
- Attaches `entryId` to each message for tree correlation
- Returns the full tree structure (all entries, not just current branch)
- Supports pagination (forward via `afterEntryId`, backward via `beforeEntryId`)

**Use when**: You need to render a chat UI with tree navigation, deletion
support, or pagination. This is what the web frontend uses.

### Difference Summary

| Dimension | `get_messages` | `get_full_messages` |
|---|---|---|
| Source | `agent.state.messages` | `sessionManager.getBranch()` |
| Has entryId | No | Yes |
| Tree structure | No | Yes (all entries) |
| Deletion filtering | Via buildSessionContext | Explicit (checks deletion entries) |
| Segment summary | Via buildSessionContext | Explicit (checks segment_summary entries) |
| Pagination | No | Yes (forward + backward) |
| Compaction handling | Summary replaces old msgs | Summary not included in messages list; returned separately |

## RPC API Reference

### navigate_tree

Execute a rollback by moving the leaf pointer.

```typescript
// Request
{ type: "navigate_tree", targetId: string, summarize?: boolean, skipFiles?: boolean, ... }

// Response
{ cancelled: boolean, editorText?: string, newLeafId: string | null, reason?: string }
```

- `cancelled: true` with `reason` — blocked by safety check (would remove all
  user messages while restoring files). Retry with `skipFiles: true` for
  message-only rollback.
- `newLeafId: null` — navigated to root (empty conversation state)
- `editorText` — the text of the target user message (for editor prefill)

### rollback_preview

Preview which files would change if rollback is executed. Does not modify disk.

```typescript
// Request
{ type: "rollback_preview", targetId: string }

// Response
{
  restored: string[],     // files that would be restored to older content
  deleted: string[],      // files that would be deleted (didn't exist at target)
  skipped: string[],      // files unchanged
  dirty: string[],        // files modified outside snapshot system
  forceRestored: string[] // dirty files force-restored anyway
}
```

### get_modified_files

List all files that changed across snapshots on the current path.

```typescript
// Request
{ type: "get_modified_files", fromEntryId?: string, toEntryId?: string }

// Response (array of)
{ path: string, status: "added"|"modified"|"deleted", entryId: string }
```

### get_file_diff

Get before/after content for a specific file.

```typescript
// Request
{ type: "get_file_diff", filePath: string, fromEntryId?: string }

// Response
{ oldContent: string | null, newContent: string | null }
// oldContent: from snapshot tree (null = file didn't exist)
// newContent: from disk (null = file deleted from disk)
```

## Reading Data After Rollback: Code Examples

### Example 1: Simple — Get current messages after rollback

```typescript
// After navigateTree completes:
const result = await rpcClient.navigateTree(targetEntryId, { skipFiles: false });
if (result.cancelled) {
  console.log("Blocked:", result.reason);
  return;
}

// Messages are already updated:
const messages = await rpcClient.getMessages();
// messages contains only the new branch's conversation
```

### Example 2: Full — Render chat with tree after rollback

```typescript
const result = await rpcClient.navigateTree(targetEntryId);

// Get full view with tree structure:
const data = await rpcClient.getFullMessages({ limit: 50 });

// data.messages — current branch messages with entryId
// data.tree.entries — all entries for tree rendering
// data.tree.leafId — current position (null = root)
// data.hasMore — whether older messages exist
```

### Example 3: Preview before rollback

```typescript
// Check what files would change:
const preview = await rpcClient.previewRollback(targetEntryId);
console.log("Files to restore:", preview.restored);
console.log("Files to delete:", preview.deleted);

// If user confirms:
await rpcClient.navigateTree(targetEntryId, { skipFiles: false });
```

### Example 4: Message-only rollback (no file changes)

```typescript
// Rollback conversation without touching files:
await rpcClient.navigateTree(targetEntryId, { skipFiles: true });
const messages = await rpcClient.getMessages();
```

## Safety Checks

### "Remove all user messages" guard

When `skipFiles !== true`, the system checks if the navigation target would
remove all user messages from the path (meaning files would be restored to
pre-session state). If so, the operation is **blocked**:

```
cancelled: true
reason: "Navigation to "<id>" would remove all user messages and restore files
         to their pre-session state. Use message-only rollback (skipFiles: true)
         to undo without file changes."
```

This prevents accidental destructive file restoration when navigating to the
conversation root.

## Related Documents

- [Rollback Architecture](rollback-architecture.md) — FileSnapshotManager design,
  data models, migration plan
- [File Rollback Design](file-rollback-design.md) — Tree rollback vs fork, file
  restoration flow, conflict detection
- [File Store Performance](file-store-performance.md) — Deterministic data
  sources, read-only-what-you-need principles
- [Session Format](session-format.md) — Entry types, tree structure,
  buildSessionContext internals
- [RPC Protocol](rpc.md) — Full RPC command reference
