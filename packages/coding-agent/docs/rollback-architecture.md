# Rollback Architecture — Design Document

## 1. Overview

The session tree supports branching and navigation via `navigateTree()`, but file system state does not always follow. The `file-snapshot` extension creates per-turn snapshots using content-addressable storage and restores files on `session_tree` events, but it has gaps: no selective rollback, no API for querying modified files, no per-message diff, and a preview-mode bug where results are discarded.

This document designs a unified rollback architecture that:

1. Supports **selective rollback**: message-only or both (messages + files)
2. Exposes a **get modified files** API for the entire session (or any range)
3. Exposes a **per-message file diff** API (before/after snapshot diff)
4. Fixes the preview-mode bug
5. Integrates snapshot logic into core for better testability and API surface
6. Maintains append-only semantics — `session.jsonl` is never mutated

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Extension vs core | Integrate into core | `InternalGit` already lives in `src/core/file-store/`. Snapshot logic is fundamental to session integrity. Bugs in extension code (preview void) would be caught by core tests. Selective rollback needs deep session access. |
| Extension after integration | Thin adapter | Extension stays as a hook-registration shim (registers `session_start`, `turn_end`, `session_tree` handlers that delegate to `FileSnapshotManager`). |
| Entry format | No new entry types | Continue using `step-snapshot` custom entries. Unrevert-point entries stay as-is. |
| Storage format | No change | FNV-1a content-addressable objects under `~/.pi/agent/file-store/<projectHash>/objects/`. |
| Rollback modes | 2 modes: "message" and "both" | "code"-only mode removed. Users can edit files directly if they only want file changes. |

---

## 2. Current Architecture

### 2.1 Components

```
InternalGit (src/core/file-store/internal-git.ts)
  - Content-addressable object store (FNV-1a hashing)
  - Tree snapshots: writeTree(), readTree()
  - Diff computation: computeDiff(), diffTrees()
  - Working directory scanning: scanWorkingDir()
  - Ignores .git, node_modules, .pi, etc. via `ignore` package

file-snapshot extension (extensions/file-snapshot/index.ts)
  - Duplicate ObjectStore class ( reimplements InternalGit with simpler ignore logic)
  - Hooks: session_start, turn_end, session_tree
  - Creates step-snapshot custom entries per turn
  - Restores files on session_tree event
  - Creates unrevert-point entries before restoration
  - BUG: preview mode discards result via `void { ... }`

AgentSession.navigateTree() (src/core/agent-session.ts)
  - Moves leaf pointer via sessionManager.branch()
  - Emits session_before_tree → session_tree events
  - skipFiles option passes through to session_tree event
  - previewRollback() emits session_tree with preview: true
  - BUG: previewRollback() doesn't get result back from extension

SessionTreeEvent (src/core/extensions/types.ts)
  - { type, newLeafId, oldLeafId, summaryEntry?, skipFiles?, preview? }
  - No rollbackMode field
```

### 2.2 Data Flow (current)

```
session_start
  → ObjectStore.scanWorkingDir() → sessionStartTreeHash

turn_end
  → ObjectStore.scanWorkingDir() → snapshotTreeHash
  → computeTreeDiff(lastCommittedTreeHash, snapshotTreeHash)
  → if hasChanges: pi.appendEntry("step-snapshot", { baselineTreeHash, snapshotTreeHash, diff, turnIndex })

navigateTree (user triggers /tree)
  → AgentSession.navigateTree(targetId, { skipFiles? })
  → sessionManager.branch(targetId)
  → emit session_tree event
      → extension reads step-snapshot entries on path
      → finds target tree hash vs current tree hash
      → if !skipFiles: restoreFiles() + deleteFiles()
      → appends unrevert-point entry

previewRollback
  → emit session_tree with preview: true
  → extension: void { restored, deleted } ← BUG: discards result
```

### 2.3 Known Issues

| Issue | Location | Description |
|---|---|---|
| Duplicate storage logic | `extensions/file-snapshot/index.ts:101-234` | `ObjectStore` duplicates `InternalGit` with simpler ignore patterns (no `ignore` package, custom `matchGlob`). |
| Preview bug | `extensions/file-snapshot/index.ts:356-359` | `void { restored, deleted }` discards result instead of returning it. |
| No selective restore | `extensions/file-snapshot/index.ts:309-372` | `session_tree` handler restores ALL files or none (via `skipFiles`). No partial restore. |
| skipFiles not user-facing | `src/core/agent-session.ts:3178` | `skipFiles` exists but is not exposed via RPC or TUI. |
| No modified-files query | — | No API to list files changed between any two points. |
| No per-file diff | — | No API to get unified diff for a specific file between snapshots. |
| 1MB file limit only in extension | `extensions/file-snapshot/index.ts:163` | Extension skips files > 1MB but `InternalGit` has no such limit. Inconsistent behavior. |

---

## 3. Target Architecture

### 3.1 Component Diagram

```
AgentSession
    │
    ├── SessionManager (session.jsonl tree, entry CRUD)
    │
    ├── FileSnapshotManager (NEW — src/core/file-store/file-snapshot-manager.ts)
    │     │
    │     ├── InternalGit (existing — content-addressable storage)
    │     │
    │     ├── snapshotWorkingDir()      — scan + store tree, return hash
    │     ├── getSnapshotAtTurn(n)      — query snapshot by turn index
    │     ├── getSnapshotAtEntry(id)    — query snapshot by entry ID
    │     ├── getModifiedFiles(opts)    — list files changed between two points
    │     ├── getFileDiff(opts)         — unified diff for a specific file
    │     ├── restoreFiles(opts)        — selective file restoration
    │     │     opts: { targetEntryId?, snapshotHash?, files?: string[], preview? }
    │     └── buildSnapshotIndex()      — rebuild in-memory index from entries
    │
    ├── navigateTree(targetId, opts) — ENHANCED
    │     opts.skipFiles: boolean  (default: false)
    │
    └── ExtensionRunner
          └── file-snapshot extension (THIN adapter)
                delegates to FileSnapshotManager
```

### 3.2 FileSnapshotManager

```typescript
class FileSnapshotManager {
  private git: InternalGit;
  private sessionStartTreeHash: string | null;
  private lastCommittedTreeHash: string | null;
  private turnIndex: number;
  private snapshotIndex: Map<string, StepSnapshotData>;  // entryId → snapshot
  private turnIndexMap: Map<number, string>;              // turnIndex → entryId

  constructor(git: InternalGit);

  // Called on session_start
  initialize(cwd: string): Promise<void>;

  // Called on turn_end
  onTurnEnd(cwd: string, appendEntry: (data: StepSnapshotData) => void): void;

  // Called on session reload to rebuild index from custom entries
  rebuildIndex(entries: SessionEntry[]): void;

  // Query
  getSnapshotAtTurn(turnIndex: number): StepSnapshotData | null;
  getSnapshotAtEntry(entryId: string): StepSnapshotData | null;
  getLatestSnapshotOnPath(entries: SessionEntry[], leafId: string | null): StepSnapshotData | null;

  // Modified files API
  getModifiedFiles(options?: {
    fromEntryId?: string;
    toEntryId?: string;
  }): ModifiedFileInfo[];

  // Per-file diff API
  getFileDiff(options: {
    filePath: string;
    fromEntryId?: string;
    toEntryId?: string;
  }): FileDiffInfo | null;

  // File restoration
  restoreFiles(cwd: string, options: {
    targetEntryId?: string;
    snapshotHash?: string;
    files?: string[];
    preview?: boolean;
    currentLeafId?: string | null;
    entries: SessionEntry[];
    appendEntry: (type: string, data: unknown) => void;
  }): Promise<RestoreResult>;
}
```

### 3.3 Rollback Behavior

`navigateTree` uses a simple `skipFiles: boolean` option:

```
┌─────────────┬──────────────────────┬──────────────────────┐
│ skipFiles   │ Move leaf pointer    │ Restore files        │
├─────────────┼──────────────────────┼──────────────────────┤
│ false       │ Yes                  │ Yes                  │
│ true        │ Yes                  │ No                   │
└─────────────┴──────────────────────┴──────────────────────┘
```

- `skipFiles: false` (default) — move leaf + restore file snapshot. This is the existing behavior.
- `skipFiles: true` — move leaf only, skip file restoration. Useful when the user wants to rewind the conversation but keep current files on disk.

There is no "code"-only mode. Users who want to restore files without moving the conversation can edit files directly.

---

## 4. API Design

### 4.1 ModifiedFileInfo

```typescript
interface ModifiedFileInfo {
  path: string;
  status: "added" | "modified" | "deleted";
  turnIndex: number;
  entryId: string;    // step-snapshot entry that recorded this change
}
```

### 4.2 FileDiffInfo

```typescript
interface FileDiffInfo {
  path: string;
  oldContent: string | null;   // null if file didn't exist at fromSnapshot
  newContent: string | null;   // null if file was deleted at toSnapshot
  oldHash: string | null;
  newHash: string | null;
  unifiedDiff: string;         // standard unified diff format
}
```

### 4.3 RestoreResult

```typescript
interface RestoreResult {
  restored: string[];    // files written back
  deleted: string[];     // files removed
  skipped: string[];     // files that were dirty (externally modified) and skipped
  dirty: string[];       // files that differed from expected current state
}
```

### 4.4 StepSnapshotData (entry data format, unchanged)

```typescript
interface StepSnapshotData {
  baselineTreeHash: string | null;
  snapshotTreeHash: string;
  diff: {
    added: string[];
    modified: string[];
    deleted: string[];
  } | null;
  turnIndex: number;
}
```

### 4.5 FileSnapshotManager Methods

#### `getModifiedFiles(options?)`

Lists all files that changed between two snapshots. Defaults to full session range (session start → current leaf).

```typescript
getModifiedFiles(options?: {
  fromEntryId?: string;  // default: session start (no snapshot)
  toEntryId?: string;    // default: latest snapshot on current leaf path
}): ModifiedFileInfo[]
```

Algorithm:
1. Resolve `fromEntryId` to a snapshot (null → session start tree).
2. Resolve `toEntryId` to a snapshot (null → latest on leaf path).
3. Use `git.diffTrees()` or walk step-snapshot entries on the path, accumulating changes.
4. Return aggregated list with earliest turnIndex for each file.

#### `getFileDiff(options)`

Returns before/after content and unified diff for a single file.

```typescript
getFileDiff(options: {
  filePath: string;
  fromEntryId?: string;  // default: session start
  toEntryId?: string;    // default: current leaf
}): FileDiffInfo | null
```

Algorithm:
1. Resolve from/to snapshots.
2. Read both trees via `git.readTree()`.
3. Extract file content from each.
4. Generate unified diff (use `diffLines` from `diff` package or simple line-based diff).
5. Return `null` if file exists in neither snapshot.

#### `restoreFiles(cwd, options)`

Restores files to a target snapshot state. Supports selective file list and preview mode.

```typescript
restoreFiles(cwd: string, options: {
  targetEntryId?: string;    // resolve to snapshot hash
  snapshotHash?: string;     // or provide hash directly
  files?: string[];          // if provided, only restore these files
  preview?: boolean;         // if true, return what would happen without writing
  currentLeafId?: string | null;
  entries: SessionEntry[];
  appendEntry: (type: string, data: unknown) => void;
}): Promise<RestoreResult>
```

Algorithm:
1. Resolve target snapshot hash from `targetEntryId` or use `snapshotHash` directly.
2. Resolve current snapshot hash from latest snapshot on `currentLeafId` path.
3. Read both trees.
4. Compute diff: files to restore (content differs) and files to delete (in current but not in target).
5. If `files` option provided, filter to only those paths.
6. **Conflict detection**: for each file to restore, read disk content, hash it, compare to current tree hash. If different, mark as `dirty`.
7. If `preview`: return result without writing.
8. If not preview: scan working dir, write unrevert-point entry, then write/delete files.

---

## 5. RPC Commands

### 5.1 New Commands

#### `get_modified_files`

```json
{
  "id": "req-1",
  "type": "get_modified_files",
  "fromEntryId": "abc123",
  "toEntryId": "def456"
}
```

Both fields optional. Defaults: `fromEntryId` = session start, `toEntryId` = current leaf.

Response:
```json
{
  "id": "req-1",
  "type": "response",
  "command": "get_modified_files",
  "success": true,
  "data": {
    "files": [
      { "path": "src/foo.ts", "status": "modified", "turnIndex": 2, "entryId": "snap123" },
      { "path": "src/bar.ts", "status": "added", "turnIndex": 3, "entryId": "snap456" }
    ]
  }
}
```

#### `get_file_diff`

```json
{
  "id": "req-2",
  "type": "get_file_diff",
  "filePath": "src/foo.ts",
  "fromEntryId": "abc123",
  "toEntryId": "def456"
}
```

`fromEntryId` and `toEntryId` optional with same defaults as above.

Response:
```json
{
  "id": "req-2",
  "type": "response",
  "command": "get_file_diff",
  "success": true,
  "data": {
    "path": "src/foo.ts",
    "oldContent": "original content\n",
    "newContent": "modified content\n",
    "oldHash": "a1b2c3d4",
    "newHash": "e5f6g7h8",
    "unifiedDiff": "--- src/foo.ts\n+++ src/foo.ts\n@@ -1 +1 @@\n-original content\n+modified content\n"
  }
}
```

Returns `null` data if file doesn't exist in either snapshot.

### 5.2 Modified Commands

#### `navigate_tree`

Current:
```json
{
  "type": "navigate_tree",
  "targetId": "abc123",
  "summarize": true,
  "skipFiles": false
}
```

`skipFiles: boolean` (default: `false`) remains the option — no `rollbackMode` field:
```json
{
  "type": "navigate_tree",
  "targetId": "abc123",
  "summarize": true,
  "skipFiles": false
}
```

Behavior:
- `skipFiles: false` (default) — move leaf + restore files (current behavior)
- `skipFiles: true` — move leaf only, skip file restoration

---

## 6. Data Model

### 6.1 Entry Types (no changes)

No new entry types. Existing entries used by the file snapshot system:

| Entry Type | customType | Purpose |
|---|---|---|
| `custom` | `step-snapshot` | Per-turn tree snapshot + diff |
| `custom` | `unrevert-point` | Pre-rollback state for undo |

### 6.2 step-snapshot Entry

Stored as a `custom` entry with `customType: "step-snapshot"`:

```json
{
  "type": "custom",
  "id": "snap1234",
  "parentId": "prev1234",
  "timestamp": "2025-05-07T10:00:00.000Z",
  "customType": "step-snapshot",
  "data": {
    "baselineTreeHash": "a1b2c3d4",
    "snapshotTreeHash": "e5f6g7h8",
    "diff": {
      "added": ["src/new-file.ts"],
      "modified": ["src/existing.ts"],
      "deleted": ["src/old-file.ts"]
    },
    "turnIndex": 3
  }
}
```

- `baselineTreeHash`: the tree hash this snapshot was compared against (previous snapshot or session start). Null if this is the first snapshot.
- `snapshotTreeHash`: the tree hash of the working directory at this turn.
- `diff`: delta from baseline to this snapshot. Null if no changes detected.
- `turnIndex`: 0-based turn counter.

### 6.3 unrevert-point Entry

Stored as a `custom` entry with `customType: "unrevert-point"`:

```json
{
  "type": "custom",
  "id": "urv1234",
  "parentId": "snap5678",
  "timestamp": "2025-05-07T10:05:00.000Z",
  "customType": "unrevert-point",
  "data": {
    "preRollbackTreeHash": "c3d4e5f6",
    "rolledBackToLeaf": "abc123",
    "restoredFiles": ["src/foo.ts", "src/bar.ts"]
  }
}
```

### 6.4 BranchSummaryEntry Extension

The `BranchSummaryEntry` gains an optional `skipFiles` field to record whether file restoration was skipped at this position:

```typescript
interface BranchSummaryEntry extends SessionEntryBase {
  type: "summary";
  summary: string;
  skipFiles?: boolean;  // true if file restoration was skipped during this navigation
}
```

This field is set when `branchWithSummary()` is called with `skipFiles: true`. Future operations can inspect the entry to determine whether files were restored at that point.

For `branch()` calls without a summary, `skipFiles` is not persisted — it's an operational parameter for that invocation only. This is acceptable because the user decides each time they navigate.

### 6.5 Object Store Layout

```
~/.pi/agent/file-store/<projectHash>/
├── objects/
│   ├── a1/
│   │   └── b2c3d4e5    # file content or tree data, keyed by FNV-1a hash
│   ├── e5/
│   │   └── f6g7h8i9
│   └── ...
```

- Blob objects: raw file content.
- Tree objects: `\n`-separated lines of `<path>\0<hash>`, sorted by path.

---

## 7. Migration Plan

### 7.1 Phase 1: Create FileSnapshotManager (non-breaking)

1. Create `src/core/file-store/file-snapshot-manager.ts`.
2. Move snapshot logic from `extensions/file-snapshot/index.ts` into `FileSnapshotManager`:
   - `scanWorkingDir` → use `InternalGit.scanWorkingDir()` (eliminate duplicate).
   - `writeTree`, `readTree`, `computeTreeDiff` → delegate to `InternalGit`.
   - `session_start` handler → `initialize()`.
   - `turn_end` handler → `onTurnEnd()`.
   - `session_tree` handler → `restoreFiles()`.
   - `findLatestSnapshotOnPath` → `getLatestSnapshotOnPath()`.
3. Fix preview bug: `restoreFiles()` returns `RestoreResult` in all code paths.
4. Port the `findCanonicalGitRoot()` and `shouldIgnore()` logic into core.
5. Harmonize file size limit: add 1MB cap to `InternalGit.scanWorkingDir()` (or make it configurable).

### 7.2 Phase 2: Add new APIs to FileSnapshotManager

1. Implement `getModifiedFiles()`.
2. Implement `getFileDiff()`.
3. Implement `buildSnapshotIndex()` for session reload.
4. Wire `FileSnapshotManager` into `AgentSession` (lazy init on `session_start`).

### 7.3 Phase 3: Enhance navigateTree

1. Keep `skipFiles: boolean` as the option on `navigateTree()` (no `rollbackMode`).
2. When `skipFiles=false`: current behavior — move leaf + restore files via file-snapshot.
3. When `skipFiles=true`: move leaf only, don't restore files.
4. Store `skipFiles` on the created `BranchSummaryEntry` if `summarize=true`.
5. If `summarize=false` and `skipFiles=true`, the flag is not persisted (operational only).
6. `SessionTreeEvent` passes `skipFiles` through (no `rollbackMode` field).

### 7.4 Phase 4: Add RPC commands

1. Add `get_modified_files` command to `rpc-types.ts` and `rpc-mode.ts`.
2. Add `get_file_diff` command.
3. No `restore_files` command — users edit files directly.
4. Keep `navigate_tree` command with `skipFiles: boolean` option.

### 7.5 Phase 5: Thin the extension

1. Update `extensions/file-snapshot/index.ts` to delegate to `AgentSession.fileSnapshotManager` instead of its own `ObjectStore`.
2. Extension becomes ~50 lines: register `session_start`/`turn_end`/`session_tree` hooks that call `ctx.sessionManager.fileSnapshotManager.*()`.
3. Extension can be disabled without losing core functionality (FileSnapshotManager always present).

---

## 8. Testing Strategy

### 8.1 Unit Tests — FileSnapshotManager

File: `test/file-store/file-snapshot-manager.test.ts`

| Test | Description |
|---|---|
| initializes with working dir snapshot | `initialize()` creates session-start tree hash |
| skips snapshot when no changes | `onTurnEnd()` with unchanged dir doesn't append entry |
| creates snapshot on file change | `onTurnEnd()` after file write produces step-snapshot data |
| creates snapshot on file add | New file detected in diff |
| creates snapshot on file delete | Removed file detected in diff |
| gets snapshot at turn index | `getSnapshotAtTurn(0)` returns first snapshot |
| gets snapshot at entry ID | `getSnapshotAtEntry(id)` returns correct snapshot |
| rebuilds index from entries | `rebuildIndex()` restores snapshot map from custom entries |
| handles empty session | No snapshots, no crashes |

### 8.2 Unit Tests — getModifiedFiles

| Test | Description |
|---|---|
| returns all changes for session | Full range from start to current |
| returns changes between two entries | Scoped range |
| returns empty for no changes | Identical snapshots |
| aggregates across multiple turns | Multiple snapshots consolidated |
| tracks per-file earliest change | Status reflects first occurrence |

### 8.3 Unit Tests — getFileDiff

| Test | Description |
|---|---|
| returns diff for modified file | oldContent vs newContent with unified diff |
| returns diff for added file | oldContent = null |
| returns diff for deleted file | newContent = null |
| returns null for non-existent file | File not in either snapshot |
| handles default range | Session start to current |

### 8.4 Unit Tests — restoreFiles

| Test | Description |
|---|---|
| restores modified files | Content written to disk |
| deletes files not in target | Files removed from disk |
| preview mode returns plan without writing | Disk unchanged |
| selective restore with files filter | Only specified files restored |
| conflict detection marks dirty files | Externally modified files in `dirty` list |
| appends unrevert-point entry | Pre-rollback state recorded |
| no-op when snapshots identical | No writes, empty result |

### 8.5 Integration Tests — navigateTree with skipFiles

File: `test/suite/navigate-tree-rollback.test.ts`

| Test | Description |
|---|---|
| skipFiles=false restores files and moves leaf | Default behavior preserved |
| skipFiles=true moves leaf without restoring files | Files unchanged on disk |
| skipFiles=true with summarize stores flag on BranchSummaryEntry | Entry has `skipFiles: true` |
| skipFiles=true without summarize does not persist flag | Operational only |
| summarize with skipFiles=false does not set flag | BranchSummaryEntry has no `skipFiles` field |

### 8.6 Integration Tests — RPC Commands

File: `test/suite/rpc-rollback.test.ts`

| Test | Description |
|---|---|
| get_modified_files returns correct list | RPC round-trip |
| get_file_diff returns unified diff | RPC round-trip |
| navigate_tree with skipFiles | RPC round-trip |

---

## 9. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| FNV-1a hash collisions | Data corruption (wrong file content) | Low (32-bit hash, ~4B values) | Hash is only used as disk key. Collision means overwriting an object with same-named content. Acceptable for snapshots, not for security. Can upgrade to SHA-256 later if needed. |
| Large project scan time | Slow `turn_end` handler, blocking agent | Medium | `InternalGit.scanWorkingDir()` reads all files. Mitigate with: (1) 1MB file cap, (2) `skipFiles` patterns, (3) consider incremental scanning in future. |
| Disk space for object store | Object accumulation over many sessions | Low | Objects are deduplicated by hash. Add periodic garbage collection of orphaned objects (objects not referenced by any session's snapshots). |
| Race condition: external file change during restore | Inconsistent restore | Low | Scan working dir immediately before restore (already done for unrevert-point). Dirty detection catches this. |
| Breaking change to extension API | Existing file-snapshot extensions break | Medium | Phase migration: Phase 1 is non-breaking (new core class, extension unchanged). Phase 5 thins extension but old extension still works if present. |
| Preview mode was broken, clients may not expect it to work | Wrong assumptions about preview reliability | Low | Preview is currently broken (void). Fixing it is a pure improvement. |
| skipFiles=true leaves conversation behind files | User rewinds messages but files stay at later state | Low | This is intentional behavior — the user explicitly chose to keep files. UI should clearly indicate when file restoration was skipped. |

---

## 10. Implementation Order

### Phase 1: Core foundation (1-2 days)

1. Create `FileSnapshotManager` class in `src/core/file-store/`.
2. Port logic from extension. Use `InternalGit` directly (no duplicate `ObjectStore`).
3. Fix preview bug.
4. Add 1MB file size limit to `InternalGit.scanWorkingDir()`.
5. Unit tests for `FileSnapshotManager` (initialize, onTurnEnd, restoreFiles basic).
6. `npm run check` passes.

### Phase 2: Query APIs (1 day)

1. Implement `getModifiedFiles()`.
2. Implement `getFileDiff()`.
3. Add unified diff generation (use existing `diff` package or implement simple line diff).
4. Unit tests for both APIs.
5. `npm run check` passes.

### Phase 3: skipFiles behavior (1 day)

1. Keep `skipFiles: boolean` on `navigateTree()` options.
2. `SessionTreeEvent` passes `skipFiles` through (no `rollbackMode`).
3. When `skipFiles=true`: move leaf only, don't restore files.
4. Add `skipFiles?: boolean` field to `BranchSummaryEntry`.
5. Store `skipFiles` on `BranchSummaryEntry` when `summarize=true` and `skipFiles=true`.
6. Integration tests for both modes (skipFiles=false, skipFiles=true).
7. `npm run check` passes.

### Phase 4: RPC surface (1 day)

1. Add `get_modified_files` and `get_file_diff` to `rpc-types.ts`.
2. Implement handlers in `rpc-mode.ts`.
3. No `restore_files` command.
4. RPC integration tests.
5. `npm run check` passes.

### Phase 5: Extension thinning (0.5 day)

1. Update `file-snapshot` extension to delegate to `ctx.sessionManager.fileSnapshotManager`.
2. Verify extension tests still pass.
3. Update `docs/extensions.md` with new architecture note.
4. `npm run check` passes.

### Phase 6: Documentation and polish (0.5 day)

1. Update `docs/rpc.md` with new commands.
2. Update `docs/tree.md` with skipFiles behavior.
3. Update `docs/session.md` with FileSnapshotManager section.
4. Final `npm run check`.
