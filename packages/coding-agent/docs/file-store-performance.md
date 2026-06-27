# File Store Performance Optimization

## Design Principles

### 1. Deterministic data sources — no guessing

Every data retrieval path must have a deterministic, predictable source:

| Field | Source | Rationale |
|---|---|---|
| `oldContent` | Snapshot tree (via `fromHash` or `fromEntryId`) | Snapshots are immutable after creation, always consistent |
| `newContent` | Disk (`readFileSync`) | Always reflects the current filesystem state |

No fallback logic that "walks snapshots backwards to guess" — if the caller doesn't provide a baseline, `oldContent` comes from `sessionStartTreeHash` (possibly `null` for empty session starts, which is a valid deterministic result).

### 2. Read only what you need

```
readTree(hash)           → reads ALL file contents in a tree   → O(N) disk IO
readTreeFiles(hash, set) → reads ONLY requested file contents  → O(M) disk IO
listTreeFiles(hash)      → reads ONLY path+hash metadata       → O(1) file content IO
```

Use the narrowest API for the job. If you only need to know which files changed (not the content), use `listTreeFiles`. If you need content for specific files, use `readTreeFiles`.

### 3. newContent always comes from disk

- `getBatchFileContents` reads `newContent` via `readDiskFile(cwd, filePath)`
- No longer depends on `toTree` (committed snapshot tree) for new content
- Eliminates the "agent is busy, snapshot is stale" problem entirely
- No need for "busy detection" or live-change merging workarounds

## API Reference

### InternalGit (low-level storage)

```typescript
class InternalGit {
  // Full tree read — reads ALL file contents (O(N) disk IO)
  readTree(treeHash: string): Map<string, string> | null;

  // Selective tree read — reads only requested paths (O(M) disk IO)
  readTreeFiles(treeHash: string, wanted: Set<string>): Map<string, string> | null;

  // Metadata-only — returns path→hash, no file content reads (O(1) content IO)
  listTreeFiles(treeHash: string): Map<string, string> | null;

  // Hash a string (used for comparison)
  hashContent(content: string): string;
}
```

### FileSnapshotManager

```typescript
class FileSnapshotManager {
  // Batch content retrieval for review.pending
  // oldContent → from snapshot baseline (fromHash or fromEntryId)
  // newContent → from disk (readDiskFile)
  getBatchFileContents(
    filePaths: Array<{
      filePath: string;
      fromEntryId?: string;   // Session entry ID → resolves to tree hash via snapshotIndex
      fromHash?: string;      // Direct tree hash (bypasses entryId lookup)
    }>,
    cwd: string,
  ): Map<string, { oldContent: string | null; newContent: string | null }>;

  // Single file diff
  getFileDiff(options: {
    filePath: string;
    fromEntryId?: string;
    toEntryId?: string;
    useBaselineHash?: boolean;
  }): FileDiffInfo | null;

  // Batch diffs (for RPC mode)
  getBatchDiffs(options: {
    fromEntryId?: string;
    toEntryId?: string;
    cwd: string;  // required — needed for disk reads
  }): BatchDiffResult;

  // Rollback preview — uses hash comparison, no file content reads
  getRollbackPreviewFiles(options: {
    targetEntryId: string;
    entries: SessionEntry[];
  }): ModifiedFileInfo[];

  // Restore files — selective read when options.files is provided
  restoreFiles(cwd: string, options: {
    targetEntryId?: string;
    snapshotHash?: string;
    files?: string[];      // When provided, only these files are read from trees
    preview?: boolean;
    currentLeafId?: string | null;
    entries: SessionEntry[];
    appendEntry?: (type: string, data: unknown) => void;
  }): Promise<RestoreResult>;
}
```

## Key Caller: file-review Extension

The `file-review` extension is the main consumer of these APIs. Its `review.pending` handler:

```
1. Build pathMeta from turnLog (firstStatus, firstTurnIndex, latestFileStatus)
2. Build turnToTreeHash from session entries (turnIndex → treeHash)
3. For each file:
   fromHash = approvedSnapshotEntry.get(path) ? treeHashOfApproval : turnToTreeHash.get(firstTurnIndex)
   fromEntryId = approvedSnapshotEntry.get(path) (if approved)
4. Call getBatchFileContents(fileRequests, ctx.cwd)
5. Merge with liveChanges from getLiveChanges(ctx.cwd)
6. oldContent override logic:
   - If latestFileStatus === "added" → null (genuinely new)
   - Otherwise → batchDiff.oldContent (from baseline snapshot)
```

## Complexity Comparison

| Scenario | Before | After |
|---|---|---|
| Batch file contents (N=1000 files, M=5 wanted) | O(N) disk IO per tree | O(M) disk IO |
| Single file diff | 2 full tree reads (O(N)) | 2 selective reads (O(1)) |
| Rollback preview | 2 full tree reads (O(N) content IO) | 2 metadata reads (0 content IO) |
| Tree listing (paths only) | Full read (O(N) content IO) | Metadata only (0 content IO) |

## Migration Notes

### For callers of `getBatchFileContents`

1. Add `cwd` parameter — needed for `readDiskFile`
2. `newContent` is now from disk (always live), not from snapshot tree
3. Optional `fromHash` field bypasses entryId lookup — use when you already have the tree hash

### For callers of `getBatchDiffs`

1. Add `cwd` parameter to options — required
2. `newContent` is now from disk

### For callers of `getFileDiff`

1. No `cwd` needed (still reads from trees)
2. Without `fromEntryId`, `oldContent` comes from `sessionStartTreeHash`
3. No fallback — provide `fromEntryId` for a specific baseline
