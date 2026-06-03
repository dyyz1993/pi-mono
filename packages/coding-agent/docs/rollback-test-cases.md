# Rollback Test Cases

## Conventions

- **Entry types**: user message (U), assistant message (A), tool result (T), step-snapshot (S), compaction (C), deletion (D), segment_summary (SS), branch_summary (BS)
- **File state**: tracked by snapshot hash. Each step-snapshot records baselineTreeHash → snapshotTreeHash
- **Event log**: records every event in order with data

---

## Case 1: Basic Rollback (Message + Files)

### Scenario
Create file A → Modify file B → Rollback to "Create file A" message → Both message and files restored

### Steps

| Step | Action | Entries Created | File State | Snapshot |
|------|--------|-----------------|------------|----------|
| 1 | User: "create file A" | U1 | — | — |
| 2 | Assistant creates file A (write tool) | A1, T1 | A exists | S1: baseline=null→hash1 |
| 3 | User: "modify file B" | U2 | — | — |
| 4 | Assistant modifies file B (edit tool) | A2, T2 | A, B(modified) | S2: hash1→hash2 |
| 5 | Rollback to U1 (skipFiles=false) | BS1(skipFiles=false) | A, B(original) | Files restored to S1 state |

### Expected Results
- leafId points to BS1 (or U1 depending on navigation)
- File A: exists (was created in step 2)
- File B: restored to pre-modification state (or deleted if didn't exist before step 4)
- Messages: only U1 and earlier visible in context
- Event log: session_tree event fires, file-snapshot restores files

### Event Log

| Order | Event | Data |
|-------|-------|------|
| 1 | `session_tree` (step 2) | { type: "step-snapshot", snapshotId: S1, treeHash: hash1 } |
| 2 | `session_tree` (step 4) | { type: "step-snapshot", snapshotId: S2, treeHash: hash2 } |
| 3 | `session_tree` (step 5) | { type: "branch_summary", entryId: BS1, rollbackTo: U1, skipFiles: false } |
| 4 | `file-snapshot` (step 5) | { action: "restore", targetHash: hash1, filesRestored: ["B"] } |

---

## Case 2: Message-Only Rollback (skipFiles=true)

### Scenario
Modify file A → Modify file B → Modify file A again → Rollback to "Modify file B" message without restoring files

### Steps

| Step | Action | Entries Created | File State | Snapshot |
|------|--------|-----------------|------------|----------|
| 1 | User: "modify file A" | U1 | — | — |
| 2 | Assistant modifies file A (v1) | A1, T1 | A(v1) | S1: null→hash1 |
| 3 | User: "modify file B" | U2 | — | — |
| 4 | Assistant modifies file B (v1) | A2, T2 | A(v1), B(v1) | S2: hash1→hash2 |
| 5 | User: "modify file A again" | U3 | — | — |
| 6 | Assistant modifies file A (v2) | A3, T3 | A(v2), B(v1) | S3: hash2→hash3 |
| 7 | Rollback to A2 (skipFiles=true) | BS1(skipFiles=true) | A(v2), B(v1) | No file restoration |

### Expected Results
- leafId points to position at A2
- File A: still v2 (not restored)
- File B: still v1 (not restored)
- Messages: only U1, A1, T1, U2, A2, T2 visible in context
- BS1 has skipFiles=true field

### Event Log

| Order | Event | Data |
|-------|-------|------|
| 1 | `session_tree` (step 2) | { type: "step-snapshot", snapshotId: S1, treeHash: hash1 } |
| 2 | `session_tree` (step 4) | { type: "step-snapshot", snapshotId: S2, treeHash: hash2 } |
| 3 | `session_tree` (step 6) | { type: "step-snapshot", snapshotId: S3, treeHash: hash3 } |
| 4 | `session_tree` (step 7) | { type: "branch_summary", entryId: BS1, rollbackTo: A2, skipFiles: true } |

---

## Case 3: Rollback After Compaction (Message Only)

### Scenario
Multiple turns → Compaction triggers → Rollback to pre-compaction message with skipFiles=true

### Steps

| Step | Action | Entries Created | File State | Snapshot |
|------|--------|-----------------|------------|----------|
| 1 | User: "create file A" | U1 | — | — |
| 2 | Assistant creates file A | A1, T1 | A exists | S1 |
| 3 | User: "create file B" | U2 | — | — |
| 4 | Assistant creates file B | A2, T2 | A, B | S2 |
| 5 | User: "create file C" | U3 | — | — |
| 6 | Assistant creates file C | A3, T3 | A, B, C | S3 |
| 7 | User: "summarize previous work" | U4 | — | — |
| 8 | Assistant responds | A4 | A, B, C | S4 (or no change) |
| 9 | Manual compaction (summarize U1-A3) | C1(summary) | A, B, C | — |
| 10 | Rollback to U2 (skipFiles=true) | BS1(skipFiles=true) | A, B, C | No file restoration |

### Expected Results
- leafId before U2 (to re-edit)
- Messages: compaction summary is gone, U1, A1, T1, U2, A2, T2 visible
- Files: unchanged (skipFiles=true)

### Event Log

| Order | Event | Data |
|-------|-------|------|
| 1 | `session_tree` (step 2) | { type: "step-snapshot", snapshotId: S1 } |
| 2 | `session_tree` (step 4) | { type: "step-snapshot", snapshotId: S2 } |
| 3 | `session_tree` (step 6) | { type: "step-snapshot", snapshotId: S3 } |
| 4 | `session_tree` (step 8) | { type: "step-snapshot", snapshotId: S4 } |
| 5 | `session_tree` (step 9) | { type: "compaction", entryId: C1, summarized: [U1,A1,T1,U2,A2,T2,U3,A3,T3] } |
| 6 | `session_tree` (step 10) | { type: "branch_summary", entryId: BS1, rollbackTo: U2, skipFiles: true } |
| 7 | `session_tree` (step 10, side effect) | { type: "compaction_undone", entryId: C1 } |

---

## Case 4: Rollback After Compaction (Message + Files)

### Scenario
Same as Case 3 but skipFiles=false

### Steps
Same as Case 3 through step 9.

| Step | Action | Entries Created | File State | Snapshot |
|------|--------|-----------------|------------|----------|
| 10 | Rollback to U2 (skipFiles=false) | BS1(skipFiles=false) | A, B (C removed) | Files restored to S2 state |

### Expected Results
- leafId before U2
- Messages: U1, A1, T1, U2, A2, T2 visible (compaction gone)
- Files: A exists, B exists, C removed (wasn't created yet at step 4)

### Event Log

| Order | Event | Data |
|-------|-------|------|
| 1 | `session_tree` (step 2) | { type: "step-snapshot", snapshotId: S1 } |
| 2 | `session_tree` (step 4) | { type: "step-snapshot", snapshotId: S2 } |
| 3 | `session_tree` (step 6) | { type: "step-snapshot", snapshotId: S3 } |
| 4 | `session_tree` (step 8) | { type: "step-snapshot", snapshotId: S4 } |
| 5 | `session_tree` (step 9) | { type: "compaction", entryId: C1, summarized: [U1..A3,T3] } |
| 6 | `session_tree` (step 10) | { type: "branch_summary", entryId: BS1, rollbackTo: U2, skipFiles: false } |
| 7 | `file-snapshot` (step 10) | { action: "restore", targetSnapshot: S2, filesRestored: ["C"], filesDeleted: ["C"] } |
| 8 | `session_tree` (step 10, side effect) | { type: "compaction_undone", entryId: C1 } |

---

## Case 5: Segment Summary + Deletion + Rollback

### Scenario
Create A, B, C → Summarize middle messages → Delete a message → Rollback to various positions

### Steps

| Step | Action | Entries Created | File State |
|------|--------|-----------------|------------|
| 1 | User: "create file A" | U1 | — |
| 2 | Assistant creates file A | A1, T1 | A |
| 3 | User: "create file B" | U2 | — |
| 4 | Assistant creates file B | A2, T2 | A, B |
| 5 | User: "create file C" | U3 | — |
| 6 | Assistant creates file C | A3, T3 | A, B, C |
| 7 | User: "do some work" | U4 | — |
| 8 | Assistant responds with tools | A4, T4 | A, B, C (possibly modified) |
| 9 | Summarize A2-T2 into segment summary | SS1(targets=[A2,T2], summary="Created file B") | A, B, C |
| 10 | Delete message A4 | D1(targets=[A4]) | A, B, C (files unchanged) |
| 11 | Rollback to U3 (skipFiles=false) | BS1 | A, B, C restored to step 6 state |

### Expected Results
- At step 9: A2,T2 replaced by segmentSummary message in LLM context
- At step 10: A4 excluded from LLM context, files unchanged
- At step 11: SS1 and D1 are after U3, so rollback goes past them → all messages restored (including A2,T2,A4)

### Event Log

| Order | Event | Data |
|-------|-------|------|
| 1 | `session_tree` (step 2) | { type: "step-snapshot", snapshotId: S1 } |
| 2 | `session_tree` (step 4) | { type: "step-snapshot", snapshotId: S2 } |
| 3 | `session_tree` (step 6) | { type: "step-snapshot", snapshotId: S3 } |
| 4 | `session_tree` (step 8) | { type: "step-snapshot", snapshotId: S4 } |
| 5 | `session_tree` (step 9) | { type: "segment_summary", entryId: SS1, targets: [A2,T2] } |
| 6 | `session_tree` (step 10) | { type: "deletion", entryId: D1, targets: [A4] } |
| 7 | `session_tree` (step 11) | { type: "branch_summary", entryId: BS1, rollbackTo: U3, skipFiles: false } |
| 8 | `file-snapshot` (step 11) | { action: "restore", targetSnapshot: S3, filesRestored: [] } |
| 9 | `session_tree` (step 11, side effect) | { type: "segment_summary_undone", entryId: SS1 } |
| 10 | `session_tree` (step 11, side effect) | { type: "deletion_undone", entryId: D1 } |

---

## Case 6: Delete Message + Rollback Restores It

### Scenario
Delete a specific message → Rollback to before the deletion → Deleted message should reappear

### Steps

| Step | Action | Entries Created | Context Visible |
|------|--------|-----------------|-----------------|
| 1 | User: "create file A" | U1 | U1 |
| 2 | Assistant creates file A | A1, T1 | U1, A1, T1 |
| 3 | User: "create file B" | U2 | U1, A1, T1, U2 |
| 4 | Assistant creates file B | A2, T2 | U1, A1, T1, U2, A2, T2 |
| 5 | Delete A1 (message only) | D1(targets=[A1]) | U1, T1, U2, A2, T2 (A1 excluded, T1 kept) |
| 6 | Rollback to U2 (skipFiles=true) | BS1(skipFiles=true) | U1, A1, T1, U2 (A1 restored, D1 after rollback point) |

### Expected Results
- After step 5: A1 excluded from context, but files unchanged
- After step 6: A1 reappears in context (D1 is after the rollback point)
- Files: unchanged throughout (skipFiles=true)

### Event Log

| Order | Event | Data |
|-------|-------|------|
| 1 | `session_tree` (step 2) | { type: "step-snapshot", snapshotId: S1 } |
| 2 | `session_tree` (step 4) | { type: "step-snapshot", snapshotId: S2 } |
| 3 | `session_tree` (step 5) | { type: "deletion", entryId: D1, targets: [A1] } |
| 4 | `session_tree` (step 6) | { type: "branch_summary", entryId: BS1, rollbackTo: U2, skipFiles: true } |
| 5 | `session_tree` (step 6, side effect) | { type: "deletion_undone", entryId: D1, restoredEntry: A1 } |

---

## Case 7: Fork Scenario

### Design Decision
Fork does NOT carry file snapshots. The forked session starts fresh:
- Object store is shared (content-addressable, files deduplicated)
- Snapshot index is empty in the forked session
- First turn_end in the fork creates a new initial snapshot
- Fork rollback is independent of original session
- Original session is not affected by fork operations

### Sub-case 7a: Basic Fork

| Step | Action | Entries | File State |
|------|--------|---------|------------|
| 1 | User: "create file A" | U1 | — |
| 2 | Assistant creates file A | A1, T1 | A |
| 3 | User: "modify file A" | U2 | — |
| 4 | Assistant modifies file A | A2, T2 | A(modified) |
| 5 | Fork from U2 | New session with U1, A1, T1, U2 | A(modified) — files not changed by fork |
| 6 | In fork: "create file B" | U1' | — |
| 7 | In fork: assistant creates B | A1', T1' | A(modified), B |
| 8 | In original: file state unchanged | — | A(modified) — no B |

#### Expected Results (7a)
- Fork session has independent entry tree
- Original session unaffected by fork operations
- File state in fork includes working directory state at fork time

#### Event Log (7a)

| Order | Event | Session | Data |
|-------|-------|---------|------|
| 1 | `session_tree` | original | { type: "step-snapshot", snapshotId: S1 } |
| 2 | `session_tree` | original | { type: "step-snapshot", snapshotId: S2 } |
| 3 | `session_tree` | original | { type: "fork", forkSessionId: "fork-1", fromEntry: U2 } |
| 4 | `session_tree` | fork | { type: "session_created", forkedFrom: original, entries: [U1,A1,T1,U2] } |
| 5 | `session_tree` | fork | { type: "step-snapshot", snapshotId: S1' } |
| 6 | `session_tree` | fork | { type: "step-snapshot", snapshotId: S2' } |

### Sub-case 7b: Fork + Rollback

| Step | Action | Entries | Expected |
|------|--------|---------|----------|
| 1-5 | Same as 7a | — | — |
| 6 | In fork: rollback to U1' (skipFiles=false) | BS1' | Files in fork: A(modified) restored, B removed |
| 7 | In original: no change | — | Original unaffected |

#### Expected Results (7b)
- Fork rollback only affects fork session
- Files in fork: B removed, A stays modified (fork has no pre-fork snapshots to restore to)
- Original session tree and file state unchanged

#### Event Log (7b)

| Order | Event | Session | Data |
|-------|-------|---------|------|
| 1-6 | Same as 7a | — | — |
| 7 | `session_tree` | fork | { type: "branch_summary", entryId: BS1', rollbackTo: U1', skipFiles: false } |
| 8 | `file-snapshot` | fork | { action: "restore", filesRestored: ["B"] } |

### Sub-case 7c: Fork of Fork

| Step | Action | Expected |
|------|--------|----------|
| 1-5 | Same as 7a | — |
| 6 | Fork the fork (from fork's current position) | New-new session, fresh snapshot index |
| 7 | In fork-of-fork: rollback works independently | No cross-contamination |

#### Expected Results (7c)
- Fork-of-fork has its own independent snapshot index
- Rollback in fork-of-fork does not affect fork or original
- No cross-contamination between any session level

---

## Case 8: Rollback Across Multiple Compactions

### Scenario
Multiple compactions → Rollback to before first compaction

### Steps

| Step | Action | Entries |
|------|--------|---------|
| 1-4 | Create files A, B (turns 1-2) | U1,A1,T1,S1, U2,A2,T2,S2 |
| 5 | Compaction of turns 1-2 | C1 |
| 6-9 | Create files C, D (turns 3-4) | U3,A3,T3,S3, U4,A4,T4,S4 |
| 10 | Compaction of turn 3 (C1+U3-A3) | C2 |
| 11 | Rollback to U2 (skipFiles=false) | BS1 |
| 12 | Verify: C1, C2 both gone, original messages restored, files restored to S2 state |

### Expected Results
- Both C1 and C2 are after U2, so rollback undoes both
- Original messages U1,A1,T1,U2,A2,T2 are restored in context
- Files: restored to S2 state (A, B exist; C, D removed)
- Entry tree: BS1 is new leaf, C1/C2 and everything after U2 is in the branch but not traversed

### Event Log

| Order | Event | Data |
|-------|-------|------|
| 1 | `session_tree` (step 2) | { type: "step-snapshot", snapshotId: S1 } |
| 2 | `session_tree` (step 4) | { type: "step-snapshot", snapshotId: S2 } |
| 3 | `session_tree` (step 5) | { type: "compaction", entryId: C1, summarized: [U1,A1,T1,U2,A2,T2] } |
| 4 | `session_tree` (step 8) | { type: "step-snapshot", snapshotId: S3 } |
| 5 | `session_tree` (step 9) | { type: "step-snapshot", snapshotId: S4 } |
| 6 | `session_tree` (step 10) | { type: "compaction", entryId: C2, summarized: [C1,U3,A3,T3] } |
| 7 | `session_tree` (step 11) | { type: "branch_summary", entryId: BS1, rollbackTo: U2, skipFiles: false } |
| 8 | `file-snapshot` (step 11) | { action: "restore", targetSnapshot: S2, filesRestored: ["C","D"], filesDeleted: ["C","D"] } |
| 9 | `session_tree` (step 11, side effect) | { type: "compaction_undone", entryId: C1 } |
| 10 | `session_tree` (step 11, side effect) | { type: "compaction_undone", entryId: C2 } |

---

## Case 9: Rollback Then Continue Conversation

### Scenario
Rollback → Continue working → Rollback again

### Steps

| Step | Action | Entries |
|------|--------|---------|
| 1-4 | Create A, modify B | U1,A1,T1,S1, U2,A2,T2,S2 |
| 5 | Rollback to U1 (skipFiles=false) | BS1, files restored |
| 6 | User: "create file C" | U3 |
| 7 | Assistant creates file C | A3, T3, S3 |
| 8 | Rollback to BS1 (skipFiles=false) | BS2, files restored to post-step-5 state |

### Expected Results
- Step 5: leafId moves to BS1, files restored to S1 state (A exists, B original)
- Step 7: new branch created from BS1, S3 snapshots current file state
- Step 8: leafId moves to BS2, files restored to S1 state again (A exists, B original, C removed)
- A3/T3/S3 branch still exists in tree (not deleted, just not traversed)

### Event Log

| Order | Event | Data |
|-------|-------|------|
| 1 | `session_tree` (step 2) | { type: "step-snapshot", snapshotId: S1 } |
| 2 | `session_tree` (step 4) | { type: "step-snapshot", snapshotId: S2 } |
| 3 | `session_tree` (step 5) | { type: "branch_summary", entryId: BS1, rollbackTo: U1, skipFiles: false } |
| 4 | `file-snapshot` (step 5) | { action: "restore", targetSnapshot: S1 } |
| 5 | `session_tree` (step 7) | { type: "step-snapshot", snapshotId: S3, branchFrom: BS1 } |
| 6 | `session_tree` (step 8) | { type: "branch_summary", entryId: BS2, rollbackTo: BS1, skipFiles: false } |
| 7 | `file-snapshot` (step 8) | { action: "restore", targetSnapshot: S1, filesRestored: ["B"], filesDeleted: ["C"] } |

---

## Case 10: Concurrent Deletion + Summary + Compaction

### Scenario
All three operations coexist → Rollback through all of them

### Steps

| Step | Action | Entries |
|------|--------|---------|
| 1-6 | Create A, B, C (3 turns) | U1,A1,T1,S1, U2,A2,T2,S2, U3,A3,T3,S3 |
| 7 | Delete A2 | D1(targets=[A2]) |
| 8 | Summarize A1-T1 | SS1(targets=[A1,T1], summary="Created file A") |
| 9 | Compact turns 1-3 | C1 |
| 10 | Rollback to U2 (skipFiles=false) | BS1 |
| 11 | Verify: D1, SS1, C1 all after rollback point, original messages restored, files at S2 state |

### Expected Results
- At step 7: A2 excluded from context
- At step 8: A1,T1 replaced by segment summary in context
- At step 9: remaining messages summarized into compaction
- At step 10: D1, SS1, C1 all undone → original messages U1,A1,T1,U2,A2,T2 visible
- Files: restored to S2 state (A, B exist; C removed)

### Event Log

| Order | Event | Data |
|-------|-------|------|
| 1 | `session_tree` (step 2) | { type: "step-snapshot", snapshotId: S1 } |
| 2 | `session_tree` (step 4) | { type: "step-snapshot", snapshotId: S2 } |
| 3 | `session_tree` (step 6) | { type: "step-snapshot", snapshotId: S3 } |
| 4 | `session_tree` (step 7) | { type: "deletion", entryId: D1, targets: [A2] } |
| 5 | `session_tree` (step 8) | { type: "segment_summary", entryId: SS1, targets: [A1,T1] } |
| 6 | `session_tree` (step 9) | { type: "compaction", entryId: C1, summarized: [SS1,U2,D1,..] } |
| 7 | `session_tree` (step 10) | { type: "branch_summary", entryId: BS1, rollbackTo: U2, skipFiles: false } |
| 8 | `file-snapshot` (step 10) | { action: "restore", targetSnapshot: S2, filesDeleted: ["C"] } |
| 9 | `session_tree` (step 10, side effect) | { type: "deletion_undone", entryId: D1 } |
| 10 | `session_tree` (step 10, side effect) | { type: "segment_summary_undone", entryId: SS1 } |
| 11 | `session_tree` (step 10, side effect) | { type: "compaction_undone", entryId: C1 } |
