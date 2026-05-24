# Session: rollback-fix-verification-20260524
Date: 2026-05-24
Module: rollback
Scenarios: 3 tested / 0 passed (all show empty file list)

## Tested
- Rollback overlay on MIDDLE user message "在这个文件修改一下内容" (entryId: ff41f136): fileCount=0
- Rollback overlay on LAST user message "随便" (entryId: 790b8147): fileCount=0
- Rollback overlay on first click (same middle message): fileCount=0

## Findings
- toUserMsgEntryId IS correctly passed via RPC (confirmed via WS interception)
- Backend resolves entryId correctly (logs: resolveEntryId: using message.entryId)
- getModifiedFiles RPC returns empty files array for ALL user messages
- Root cause: session.fileSnapshotManager is null for JSONL-only sessions
- The rebuildIndex() fix in _initFileSnapshotManager() only applies to ACTIVE sessions
- For historical/JSONL sessions, no AgentSession object exists with fileSnapshotManager
- Session dda31fa6 has 2 step-snapshot entries (both turnIndex 0) in JSONL file
- Files affected: test_audit_file.txt (added in turn 0, modified in turn 0)

## WS RPC Call Evidence
```json
{
  "method": "agent.getModifiedFiles",
  "params": {
    "sessionId": "dda31fa6-3a10-479c-b9c9-2958c0d0ceef",
    "toUserMsgEntryId": "ff41f136"
  }
}
```

## Updated
- selectors.yml: Updated to version 7 with test session details
- patterns.yml: Added console log capture and WS interception patterns
